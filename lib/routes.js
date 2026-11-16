/**
 * The `/turbo/*` HTTP surface the composer toggle talks to.
 *
 * Every route answers the local desktop window only, so the whole surface is
 * loopback-only and state changes must be same-origin. The UI gets facts here
 * — never an optimistic "fast is on" — which is what keeps the toggle honest.
 *
 * @module dsh-turbo-mode/routes
 */

import { fail, isLoopback, isSameOrigin, queryOf, readJson, sendJson } from './http.js'

/** Only the prefix below is owned by this plugin; nothing else is mounted. */
export const PREFIX = '/turbo'

/**
 * @param {object} deps
 * @param {{ version: string }} deps.meta
 * @param {(sessionId: string | undefined) => Promise<Record<string, unknown>>} deps.describe
 * @param {(sessionId: string | undefined, speed: unknown) => Promise<Record<string, unknown>>} deps.setSpeed
 * @param {(limit?: number) => Record<string, unknown>} deps.metrics
 * @param {() => void} deps.resetMetrics
 * @param {(input: { sessionId?: string, samples?: number }) => Promise<Record<string, unknown>>} deps.probe
 * @param {(input: { provider?: string, models?: string[], rounds?: number }) => Promise<Record<string, unknown>>} [deps.bench]
 */
export function createHandler({ meta, describe, setSpeed, metrics, resetMetrics, probe, bench }) {
  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  return async function handle(req, res) {
    if (!isLoopback(req)) {
      fail(res, 403, 'LOOPBACK_ONLY', 'This endpoint answers the local window only.')
      return
    }

    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '') || PREFIX
    const method = (req.method ?? 'GET').toUpperCase()
    const query = queryOf(req)

    try {
      if (path === `${PREFIX}/health` && method === 'GET') {
        sendJson(res, 200, { ok: true, version: meta.version })
        return
      }

      if (path === `${PREFIX}/state` && method === 'GET') {
        sendJson(res, 200, { ok: true, ...(await describe(query.sessionId)) })
        return
      }

      if (path === `${PREFIX}/speed` && method === 'POST') {
        if (!isSameOrigin(req)) {
          fail(res, 403, 'CROSS_ORIGIN', 'Speed changes must come from the Harness window.')
          return
        }
        const body = await readJson(req)
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : query.sessionId
        sendJson(res, 200, { ok: true, ...(await setSpeed(sessionId, body.speed)) })
        return
      }

      if (path === `${PREFIX}/metrics` && method === 'GET') {
        const limit = Number(query.limit)
        sendJson(res, 200, { ok: true, ...metrics(Number.isFinite(limit) && limit > 0 ? limit : undefined) })
        return
      }

      if (path === `${PREFIX}/metrics` && method === 'DELETE') {
        if (!isSameOrigin(req)) {
          fail(res, 403, 'CROSS_ORIGIN', 'Resetting metrics is a local, same-origin action.')
          return
        }
        resetMetrics()
        sendJson(res, 200, { ok: true })
        return
      }

      if (path === `${PREFIX}/probe` && method === 'POST') {
        if (!isSameOrigin(req)) {
          fail(res, 403, 'CROSS_ORIGIN', 'A probe spends provider quota, so it must come from the Harness window.')
          return
        }
        const body = await readJson(req)
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : query.sessionId
        const samples = Number(body.samples)
        sendJson(res, 200, {
          ok: true,
          ...(await probe({ sessionId, samples: Number.isFinite(samples) ? samples : undefined })),
        })
        return
      }

      if (path === `${PREFIX}/bench` && method === 'POST' && typeof bench === 'function') {
        if (!isSameOrigin(req)) {
          fail(res, 403, 'CROSS_ORIGIN', 'A benchmark spends provider quota, so it must come from the Harness window.')
          return
        }
        const body = await readJson(req)
        const rounds = Number(body.rounds)
        sendJson(res, 200, {
          ok: true,
          ...(await bench({
            provider: typeof body.provider === 'string' ? body.provider : undefined,
            models: Array.isArray(body.models) ? body.models : undefined,
            rounds: Number.isFinite(rounds) ? rounds : undefined,
          })),
        })
        return
      }

      fail(res, 404, 'NOT_FOUND', `No route for ${method} ${path}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      fail(res, 400, 'BAD_REQUEST', message)
    }
  }
}
