/**
 * The transport layer: the only place this plugin touches a real request.
 *
 * The Harness loop builds its model requests deep-frozen, and the LLM call
 * config has no slot for provider-specific parameters, so a priority tier has
 * to be added to the serialized JSON body. That happens here, in a `fetch`
 * shim that:
 *
 * 1. injects the tier parameter only when the endpoint's capability says the
 *    provider really honours one (never a blind `service_tier`),
 * 2. only for the session that chose Fast, resolved through
 *    AsyncLocalStorage so concurrent sessions never leak into each other,
 * 3. hands the exchange facts back to the caller that opened the request, and
 * 4. holds the next request briefly after a 429 instead of hammering the
 *    provider — a delay, never a bypass.
 *
 * The shim is installed once per process and kept as a thin pass-through. An
 * SDK that captured `globalThis.fetch` while an older copy of this plugin was
 * loaded keeps calling that same function, so the shim never carries the
 * decision logic itself: it forwards to whichever instance is live right now.
 * That keeps a stale, captured reference working instead of silently skipping
 * the parameter.
 *
 * @module dsh-turbo-mode/transport
 */

import { AsyncLocalStorage } from 'node:async_hooks'

/** Marks the installed shim so a later copy of this module recognises it. */
const PATCH = Symbol.for('dsh-turbo-mode.fetch-patch.v2')

/** Process-wide dispatch state shared by every copy of this module. */
const REGISTRY = Symbol.for('dsh-turbo-mode.registry')

/** Providers we are willing to rewrite: JSON bodies on a POST. */
const METHOD = 'POST'

/** A 429 without Retry-After waits this long before the next attempt. */
const DEFAULT_HOLD_MS = 2000

/** How often the shim checks that it is still the installed `fetch`. */
const REARM_MS = 2000

/** Never wait longer than this inside one request, even if Retry-After says so. */
const MAX_HOLD_MS = 15000

/**
 * @param {number} ms
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {string} value
 * @returns {number | undefined}
 */
function parseRetryAfter(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const at = Date.parse(value)
  if (Number.isFinite(at)) return Math.max(0, at - Date.now())
  return undefined
}

/**
 * @param {unknown} body
 * @returns {Record<string, unknown> | undefined}
 */
function asJsonBody(body) {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body)
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? /** @type {Record<string, unknown>} */ (parsed)
        : undefined
    } catch {
      return undefined
    }
  }
  if (body instanceof Uint8Array) {
    try {
      return asJsonBody(new TextDecoder().decode(body))
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * @param {unknown} input
 * @returns {string}
 */
function urlOf(input) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input !== null && typeof input === 'object' && 'url' in input) {
    const url = /** @type {{ url?: unknown }} */ (input).url
    if (typeof url === 'string') return url
  }
  return ''
}

/**
 * Read the model id out of a request body, when this body looks like a
 * completion request at all.
 * @param {Record<string, unknown>} body
 * @returns {string | undefined}
 */
function modelOf(body) {
  const model = body.model
  if (typeof model !== 'string' || model === '') return undefined
  const completionsLike = 'messages' in body || 'input' in body || 'prompt' in body
  return completionsLike ? model : undefined
}

/**
 * The one dispatch table every copy of this module shares.
 * @returns {{ base?: typeof globalThis.fetch, active?: (input: any, init: any) => Promise<any>, shim?: typeof globalThis.fetch }}
 */
function dispatch() {
  let state = /** @type {any} */ (globalThis)[REGISTRY]
  if (state === undefined) {
    state = {}
    Object.defineProperty(globalThis, REGISTRY, { value: state, configurable: true, writable: false })
  }
  return state
}

/**
 * Install the pass-through shim, re-wrapping whatever `fetch` is current now.
 *
 * Something else in the process (the local relay adapter, a proxy integration)
 * installs its own `fetch` after this plugin starts, and that later shim calls
 * the real implementation directly instead of the function it replaced, so a
 * single early installation would be silently bypassed. Installing is therefore
 * re-checkable: whenever the global no longer points at this shim, wrap the
 * newest implementation instead of giving up.
 * @param {{ base?: typeof globalThis.fetch, active?: (input: any, init: any) => Promise<any>, shim?: typeof globalThis.fetch }} state
 * @returns {boolean} whether a usable base fetch exists
 */
function installShim(state) {
  const current = globalThis.fetch
  if (typeof current !== 'function') return false
  if (state.shim !== undefined && current === state.shim) return true

  state.base = current

  /** @type {typeof globalThis.fetch} */
  const shim = async function turboFetch(input, init) {
    const active = state.active
    const base = state.base
    if (active === undefined || base === undefined) return base(input, init)
    return active(input, init)
  }

  Object.defineProperty(shim, PATCH, { value: true })
  state.shim = shim
  globalThis.fetch = shim
  return true
}

/**
 * @param {object} options
 * @param {(url: string, model: string) => { support: string, param: Record<string, unknown>, source: string, note: string }} options.capabilityFor
 * @param {number} [options.holdMs]
 * @param {{ warn: (...args: unknown[]) => void }} [options.logger]
 */
export function createTransport({ capabilityFor, holdMs = MAX_HOLD_MS, logger }) {
  const als = new AsyncLocalStorage()
  let refs = 0
  let live = false
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let watchdog
  let holdUntil = 0
  let held = 0
  let injected = 0
  /** @type {Array<Record<string, any>>} */
  const decisions = []
  const DECISION_LOG = 24

  /**
   * Keep a short, inspectable trail of what the shim decided and why. The
   * panel and the `turbo_mode` tool both surface it, and it is the only honest
   * way to answer "did the parameter actually go out?".
   * @param {Record<string, any>} entry
   */
  function logDecision(entry) {
    decisions.push({ at: Date.now(), ...entry })
    if (decisions.length > DECISION_LOG) decisions.shift()
  }

  /**
   * The context the shim can currently see, when a caller established one.
   * @returns {Record<string, any> | undefined}
   */
  function current() {
    return als.getStore()
  }

  /**
   * Run `fn` with the session's speed visible to the fetch shim.
   * @template T
   * @param {{ speed: 'standard' | 'fast', sessionId?: string, record: Record<string, any>, probeParam?: Record<string, unknown> }} context
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function runIn(context, fn) {
    return als.run(context, fn)
  }

  /**
   * Decide, apply and record the tier parameter for one exchange.
   * @param {string} url
   * @param {RequestInit | undefined} init
   * @param {Record<string, any>} request
   * @param {Record<string, any>} store
   * @returns {RequestInit | undefined}
   */
  function tierFor(url, init, request, store) {
    const body = asJsonBody(init?.body)
    if (body === undefined) {
      logDecision({ url, skipped: 'unparsed-body', hasInit: init !== undefined, bodyType: typeof init?.body })
      return init
    }

    const model = modelOf(body)
    if (model !== undefined) request.model = model
    if (model === undefined) {
      logDecision({ url, skipped: 'not-a-completion' })
      return init
    }
    if (body.service_tier !== undefined || body.serviceTier !== undefined) {
      logDecision({ url, model, skipped: 'tier-already-set' })
      return init
    }

    // A capability probe is the one caller allowed to send an undocumented
    // parameter: it exists precisely to find out whether the endpoint honours
    // one. It is always user-triggered and tiny.
    const probeParam = store?.probeParam
    const capability = capabilityFor(url, model)
    const chosen =
      probeParam !== undefined
        ? { support: 'probe', param: probeParam, source: 'probe' }
        : store?.speed === 'fast'
          ? capability
          : { support: 'standard', param: {}, source: 'speed:standard' }

    let next = init
    if (
      (chosen.support === 'documented' || chosen.support === 'verified' || chosen.support === 'probe') &&
      Object.keys(chosen.param).length > 0
    ) {
      const patched = { ...body, ...chosen.param }
      next = {
        ...init,
        body: typeof init.body === 'string' ? JSON.stringify(patched) : new TextEncoder().encode(JSON.stringify(patched)),
      }
      request.paramSent = chosen.param
      request.paramSource = chosen.source
      injected += 1
    } else if (store?.speed === 'fast') {
      request.paramBlocked = capability.support
      request.paramNote = capability.note
    }

    logDecision({
      url,
      model,
      speed: store?.speed,
      probe: probeParam !== undefined,
      support: chosen.support,
      source: chosen.source,
      injected: request.paramSent !== undefined,
      blocked: request.paramBlocked,
    })
    return next
  }

  /**
   * The live handler the shared shim forwards to.
   * @param {any} input
   * @param {any} init
   */
  async function handle(input, init) {
    const state = dispatch()
    const base = state.base
    if (base === undefined) throw new TypeError('turbo: no base fetch to call')

    const store = als.getStore()
    const request = store?.record
    const url = urlOf(input)
    const method = (init?.method ?? 'GET').toUpperCase()

    if (request === undefined) {
      logDecision({ url, method, skipped: 'no-context' })
      return base(input, init)
    }
    if (method !== METHOD) {
      logDecision({ url, method, skipped: 'not-post' })
      return base(input, init)
    }

    if (holdUntil > Date.now()) {
      const wait = Math.min(holdUntil - Date.now(), holdMs)
      if (wait > 0) {
        held += 1
        request.heldMs = (request.heldMs ?? 0) + wait
        await delay(wait)
      }
    }

    // Record the exchange even when the body cannot be parsed (a streamed body
    // is injected into nothing but is still worth measuring).
    request.url = url
    request.method = method

    const next = tierFor(url, init, request, store)
    const response = await base(input, next)
    request.status = response.status
    if (response.status === 429) {
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
      const wait = Math.min(Math.max(retryAfter ?? DEFAULT_HOLD_MS, 250), holdMs)
      holdUntil = Math.max(holdUntil, Date.now() + wait)
      request.throttled = true
      request.retryAfterMs = wait
    }
    const processingMs = response.headers.get('openai-processing-ms')
    if (processingMs !== null) request.upstreamMs = Number(processingMs)
    return response
  }

  function acquire() {
    refs += 1
    if (refs > 1) return
    const state = dispatch()
    if (!installShim(state)) {
      logger?.warn?.('turbo: no global fetch to patch; fast mode stays inactive')
      return
    }
    state.active = handle
    live = true
    // Another integration may replace `fetch` at any time; keep re-arming so a
    // Fast request is not silently downgraded to a standard one.
    if (watchdog === undefined) {
      watchdog = setInterval(() => {
        if (live) installShim(state)
      }, REARM_MS)
      watchdog.unref?.()
    }
  }

  function release() {
    refs = Math.max(0, refs - 1)
    if (refs > 0 || !live) return
    const state = dispatch()
    if (state.active === handle) state.active = undefined
    live = false
    if (watchdog !== undefined) {
      clearInterval(watchdog)
      watchdog = undefined
    }
  }

  function status() {
    return {
      patched: live,
      references: refs,
      injected,
      held,
      holdUntil,
      holding: holdUntil > Date.now(),
      armed: typeof globalThis.fetch === 'function' && dispatch().shim === globalThis.fetch,
      decisions: decisions.slice(),
    }
  }

  return { acquire, release, runIn, current, status, logDecision }
}

export { MAX_HOLD_MS, DEFAULT_HOLD_MS }
