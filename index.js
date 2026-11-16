/**
 * Host half of dsh-turbo-mode.
 *
 * Three jobs, in order of importance:
 *
 * 1. **Ask for a real priority tier** — a reference-counted `fetch` shim adds
 *    the provider's documented priority parameter to the session's outgoing
 *    requests, and to nothing else. Reasoning effort, prompts, tools,
 *    temperature and output limits are never touched.
 * 2. **Measure what actually happened** — every streamed call is timed
 *    (first token, total) and its reported usage recorded, split by the tier
 *    the session was in, so "is Fast faster" has an answer instead of a claim.
 * 3. **Tell the truth about it** — `/turbo/state` reports the endpoint's real
 *    capability, the parameter that was sent, and whether Fast is genuinely in
 *    effect. When a provider has no priority tier, the toggle says so.
 *
 * The plugin owns no Harness state. Uninstalling it leaves the profile exactly
 * as it was, apart from its own small JSON files under `<DSH_HOME>/dsh-turbo/`.
 *
 * @module dsh-turbo-mode
 */

import { join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

import { SPEEDS, hostOf, injectable, resolveCapability, verdictKey } from './lib/capability.js'
import { createMetrics } from './lib/metrics.js'
import { createHandler, PREFIX } from './lib/routes.js'
import { createState, isSpeed } from './lib/state.js'
import { createStore, resolveDshHome } from './lib/store.js'
import { createTransport } from './lib/tier.js'
import { runProbe } from './lib/probe.js'

/** Cordis plugin name (the id in `cordis.patch.yml` is `turbo`). */
export const name = 'turbo'

/** The web server carries the toggle; every other service is optional. */
export const inject = ['webServer']

/** Kept in step with package.json by `test/meta.test.mjs`. */
export const VERSION = '0.1.0'

/** Streams this plugin is already wrapping in the current async context. */
const wrapping = new AsyncLocalStorage()

/** Per-context handle, for tests and for callers that already hold the ctx. */
export const handles = new WeakMap()

/**
 * The host the fetch shim dialled, which differs from the upstream host when a
 * local relay or proxy is in front of the provider.
 *
 * @param {string | undefined} url
 * @returns {string | undefined}
 */
function proxyHostOf(url) {
  if (typeof url !== 'string' || url === '') return undefined
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === hostOf(url) ? undefined : host
  } catch {
    return undefined
  }
}

/** Hidden once in a session, not once per call. */
const WARNED = new Set()

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function numberOr(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} [rawConfig]
 */
export async function apply(ctx, rawConfig) {
  const config = {
    defaultSpeed: 'standard',
    providers: {},
    dshHome: undefined,
    holdMs: 15000,
    metricsCapacity: 200,
    probeSamples: 3,
    probeTarget: undefined,
    ...(rawConfig !== null && typeof rawConfig === 'object' ? rawConfig : {}),
  }

  const dir = join(resolveDshHome(config.dshHome), 'dsh-turbo')
  const store = createStore({ dir })
  const state = createState({
    store,
    defaultSpeed: isSpeed(config.defaultSpeed) ? config.defaultSpeed : 'standard',
  })
  await state.load()

  const saved = await store.read('capability.json')
  /** @type {Record<string, any>} */
  const verdicts = saved !== null && typeof saved.verdicts === 'object' ? saved.verdicts : {}

  const metrics = createMetrics({ capacity: numberOr(config.metricsCapacity, 200) })

  /** Last model route each session actually reached, for honest status. */
  const lastCall = new Map()

  /** The session that most recently sent a request, for callers without one. */
  let lastSessionId

  /**
   * A caller that cannot name a session — the browser has no session id yet,
   * or a tool was asked about "now" — means the conversation that is actually
   * running, and only then the profile default.
   *
   * @param {string | undefined} sessionId
   * @returns {string | undefined}
   */
  function resolveSession(sessionId) {
    if (typeof sessionId === 'string' && sessionId !== '') return sessionId
    return lastSessionId
  }

  /** @param {string} url @param {string} model */
  function capabilityFor(url, model) {
    return resolveCapability({ url, model, overrides: config.providers, verdicts })
  }

  const transport = createTransport({
    capabilityFor,
    holdMs: numberOr(config.holdMs, 15000),
    logger: ctx.logger,
  })

  ctx.effect(() => {
    transport.acquire()
    return () => transport.release()
  }, 'turbo-fetch-tier')

  ctx.effect(() => {
    ctx.logger?.info?.(
      `turbo: fast mode ready (default ${state.defaultSpeed}, ${Object.keys(verdicts).length} measured endpoint(s))`,
    )
    return () => {}
  }, 'turbo-startup')

  // ---- model stream: timing + the per-session tier decision ---------------

  const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
  if (llm !== undefined && llm !== null && typeof llm.stream === 'function') {
    /**
     * @param {any} options
     * @param {() => AsyncIterable<any>} next
     */
    const listener = (options, next) => {
      const downstream = next()
      // A wrapper adapter inside an already-wrapped stream would otherwise be
      // timed twice; the outermost wrapper owns the measurement.
      if (wrapping.getStore() !== undefined) return downstream

      const speed = state.speedFor(options?.sessionId)
      // A capability probe establishes its own transport context; inherit its
      // parameter so this wrapper does not silently cancel the experiment.
      const probeParam = transport.current()?.probeParam
      const record = {
        at: Date.now(),
        provider: options?.provider,
        model: options?.model,
        speed,
      }
      const started = performance.now()

      return (async function* turboStream() {
        let firstTokenMs
        let totalMs
        let usage
        let finish
        let completed = false
        /** @type {AsyncIterator<any> | undefined} */
        let iterator
        try {
          iterator = downstream[Symbol.asyncIterator]()
          for (;;) {
            const step = await wrapping.run(record, () => transport.runIn({ speed, record, probeParam }, () => iterator.next()))
            if (step.done) break
            const chunk = step.value
            if (chunk !== null && chunk !== undefined) {
              if (firstTokenMs === undefined && (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta')) {
                firstTokenMs = performance.now() - started
              }
              if (chunk.type === 'usage' && chunk.usage !== undefined) usage = chunk.usage
              if (chunk.type === 'finish') {
                finish = chunk.reason
                totalMs = performance.now() - started
              }
            }
            yield chunk
          }
          completed = true
        } finally {
          if (!completed) {
            // The consumer walked away: close the upstream stream so the
            // provider stops generating and the socket is released.
            try {
              await iterator?.return?.()
            } catch {}
            totalMs = performance.now() - started
          }
          if (totalMs === undefined) totalMs = performance.now() - started
          const failure = finish !== undefined && (finish.kind === 'error' || finish.kind === 'aborted') ? finish.failure : undefined
          record.ok = failure === undefined
          if (failure !== undefined) {
            record.failureCode = failure.code
            record.status = failure.status
          }
          record.headersMs = undefined
          record.firstTokenMs = firstTokenMs
          record.totalMs = totalMs
          record.heldMs = record.heldMs ?? 0
          record.throttled = record.throttled === true
          if (usage !== undefined) {
            record.outputTokens = usage.outputTokens
            const generating = (totalMs - (firstTokenMs ?? totalMs)) / 1000
            if (generating > 0 && usage.outputTokens > 0) {
              record.tokensPerSecond = usage.outputTokens / generating
            }
          }
          record.host = hostOf(record.url)
          record.proxyHost = proxyHostOf(record.url)
          metrics.push(record)
          const sessionId = options?.sessionId
          if (typeof sessionId === 'string' && record.url !== undefined) {
            lastSessionId = sessionId
            lastCall.set(sessionId, { provider: record.provider, model: record.model, url: record.url, host: record.host })
          }
          if (record.ok !== true && record.paramBlocked === 'unknown' && typeof sessionId === 'string' && !WARNED.has(sessionId)) {
            WARNED.add(sessionId)
            ctx.logger?.info?.(
              `turbo: ${record.host ?? 'this endpoint'} has no declared priority tier; Fast is not being sent here`,
            )
          }
        }
      })()
    }

    ctx.effect(() => {
      const dispose = ctx.on('llm/stream', listener)
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    }, 'turbo-llm-stream')
  }

  // ---- the HTTP surface the composer toggle uses --------------------------

  /** @param {string | undefined} sessionId */
  function describeSession(sessionId) {
    const resolved = resolveSession(sessionId)
    const speed = state.speedFor(resolved)
    const last = typeof resolved === 'string' ? lastCall.get(resolved) : undefined
    const capability = last === undefined
      ? {
          support: 'unknown',
          param: {},
          source: 'none',
          note: 'No model call has reached a provider from this session yet, so this endpoint is unclassified.',
        }
      : capabilityFor(last.url, last.model)

    const applied = capability.param === undefined || Object.keys(capability.param).length === 0
      ? undefined
      : capability.param

    return {
      version: VERSION,
      speeds: [...SPEEDS],
      speed,
      sessionId: resolved,
      scope: resolved === undefined ? 'profile' : 'session',
      defaultSpeed: state.defaultSpeed,
      sessionCount: state.sessionCount,
      model: last?.model,
      provider: last?.provider,
      endpoint: last?.host,
      capability: {
        support: capability.support,
        source: capability.source,
        note: capability.note,
        param: applied,
      },
      // The one field the UI must trust: Fast is in effect only when the
      // session chose it AND this endpoint accepts a parameter we can send.
      effective: speed === 'fast' && injectable(capability),
      transport: transport.status(),
      metrics: metrics.summary({ limit: 100 }),
    }
  }

  /**
   * @param {string | undefined} sessionId
   * @param {unknown} speed
   */
  async function setSpeed(sessionId, speed) {
    if (!isSpeed(speed)) {
      throw new Error(`speed must be one of ${SPEEDS.join(', ')}`)
    }
    const resolved = resolveSession(sessionId)
    await state.setSpeed(resolved, speed)
    if (typeof resolved === 'string' && resolved !== '' && resolved !== 'global') WARNED.delete(resolved)
    return describeSession(resolved)
  }

  /**
   * @param {object} input
   * @param {string} [input.sessionId]
   * @param {number} [input.samples]
   */
  async function probe({ sessionId, samples }) {
    const resolved = resolveSession(sessionId)
    const last = typeof resolved === 'string' ? lastCall.get(resolved) : undefined
    const target = last ?? config.probeTarget
    if (target === undefined) {
      throw new Error('Send one message in this session first, so the plugin knows which endpoint to probe.')
    }
    const provider = target.provider
    const model = target.model
    if (typeof provider !== 'string' || typeof model !== 'string') {
      throw new Error('The probe needs both a provider and a model id.')
    }

    let effort
    try {
      const info = typeof llm.resolveModelInfo === 'function' ? llm.resolveModelInfo(provider, model) : undefined
      effort = info?.reasoning?.defaultEffort
    } catch {
      effort = undefined
    }

    const result = await runProbe({
      llm,
      provider,
      model,
      effort,
      transport,
      samples: samples ?? numberOr(config.probeSamples, 3),
    })
    result.host = hostOf(target.url)
    result.model = model
    result.provider = provider
    result.at = Date.now()

    verdicts[verdictKey(result.host, model)] = {
      verdict: result.verdict,
      deltaPct: result.deltaPct,
      samples: result.samples,
      at: result.at,
    }
    await store.write('capability.json', { version: 1, verdicts })

    return { probe: result, state: describeSession(resolved) }
  }

  const handle = createHandler({
    meta: { version: VERSION },
    describe: async (sessionId) => describeSession(sessionId),
    setSpeed,
    metrics: (limit) => ({
      summary: metrics.summary({ limit: limit ?? 200 }),
      requests: metrics.list(limit ?? 50),
      transport: transport.status(),
    }),
    resetMetrics: () => metrics.clear(),
    probe: async (input) => probe(input),
  })

  if (ctx.webServer !== undefined && typeof ctx.webServer.register === 'function') {
    ctx.effect(() => {
      const dispose = ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: handle })
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    }, 'turbo-http')
  }

  // ---- one operation, two entrances: the toggle and a model-facing tool ---

  const tools = typeof ctx.get === 'function' ? ctx.get('tools') : undefined
  if (tools !== undefined && tools !== null && typeof tools.register === 'function') {
    ctx.effect(() => {
      const dispose = tools.register(
        {
          name: 'turbo_mode',
          description:
            'Read or change this Harness instance\'s speed tier (dsh-turbo-mode). "standard" is the provider\'s default service tier; "fast" asks for the provider\'s documented priority tier where one exists, without changing the model, reasoning effort, or output length. Also reports measured latency and can probe whether the current endpoint really honours a priority tier.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['status', 'set', 'metrics', 'probe'],
                description: 'status reads the tier and latency summary; set changes it; probe measures the endpoint.',
              },
              speed: {
                type: 'string',
                enum: ['standard', 'fast'],
                description: 'Target speed for action "set".',
              },
              sessionId: { type: 'string', description: 'Session to act on; omit for the profile default.' },
            },
            required: ['action'],
            additionalProperties: false,
          },
          output: {
            schema: { type: 'object', properties: { ok: { type: 'boolean' } }, additionalProperties: true },
            render: (args) => [{ type: 'text', text: `turbo: ${String(args?.action ?? 'status')}` }],
          },
          async execute(args) {
            const action = args !== null && typeof args === 'object' ? args.action : 'status'
            const sessionId = args !== null && typeof args === 'object' && typeof args.sessionId === 'string' ? args.sessionId : undefined
            if (action === 'set') return { ok: true, ...(await setSpeed(sessionId, args.speed)) }
            if (action === 'metrics') return { ok: true, summary: metrics.summary({ limit: 200 }) }
            if (action === 'probe') return { ok: true, ...(await probe({ sessionId })) }
            return { ok: true, ...describeSession(sessionId) }
          },
        },
        {},
      )
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    }, 'turbo-tool')
  }

  // Cordis treats a plugin's return value as an effect (a plain object aborts
  // activation with "Invalid effect") and forbids ad-hoc context properties
  // ("cannot set property ... without provide"), so the handle is parked in a
  // module-level map for tests and for anything else that needs it.
  handles.set(ctx, { describe: describeSession, setSpeed, probe, metrics, transport, state })
}
