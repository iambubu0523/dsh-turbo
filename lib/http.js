/**
 * HTTP plumbing for the `/turbo/*` surface.
 *
 * The endpoint only ever answers the local window that renders the toggle, so
 * every route is loopback-only and mutations must be same-origin.
 *
 * @module dsh-turbo-mode/http
 */

/** Bodies here are a speed name plus an id; anything larger is a client bug. */
const MAX_BODY_BYTES = 16 * 1024

/** @param {import('node:http').IncomingMessage} req */
export function isLoopback(req) {
  const address = req.socket?.remoteAddress
  if (address === undefined) return true
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
    || address.startsWith('127.')
}

/**
 * Same-origin guard for mutations. A missing Origin is allowed (the Desktop
 * shell strips it); a present Origin must match the Host header.
 * @param {import('node:http').IncomingMessage} req
 */
export function isSameOrigin(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
export function sendJson(res, status, payload) {
  if (res.writableEnded || res.destroyed) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} code
 * @param {string} [message]
 */
export function fail(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, ...(message === undefined ? {} : { message }) } })
}

/**
 * Read and parse a small JSON request body.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [cap]
 * @returns {Promise<Record<string, unknown>>}
 */
export function readJson(req, cap = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > cap) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        resolve({})
        return
      }
      try {
        const value = JSON.parse(text)
        resolve(value !== null && typeof value === 'object' ? value : {})
      } catch {
        reject(new Error('body is not JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Query parameters as a flat string map.
 * @param {import('node:http').IncomingMessage} req
 */
export function queryOf(req) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  /** @type {Record<string, string>} */
  const out = {}
  for (const [key, value] of url.searchParams) out[key] = value
  return out
}
