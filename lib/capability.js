/**
 * Which endpoint accepts which speed parameter, and how sure we are.
 *
 * The rule this module enforces: a request carries a priority parameter only
 * when the endpoint's support is either documented by the vendor or measured
 * by this plugin's own probe. An unknown endpoint is never sent a blind
 * `service_tier`; it is reported as unknown instead, which is the difference
 * between a real fast mode and a placebo.
 *
 * @module dsh-turbo-mode/capability
 */

/** The two speeds a session can run at. */
export const SPEEDS = /** @type {const} */ (['standard', 'fast'])

/**
 * How a capability was established.
 * - `documented`: the vendor documents a priority tier for this endpoint.
 * - `verified`: this plugin measured a speed-up on this endpoint+model.
 * - `accepted-no-effect`: the endpoint took the parameter but showed no gain.
 * - `unsupported`: the endpoint has no priority tier, or rejected the parameter.
 * - `unknown`: nothing is known yet; the parameter is not sent.
 */
export const SUPPORT_LEVELS = /** @type {const} */ (
  ['documented', 'verified', 'accepted-no-effect', 'unsupported', 'unknown']
)

/** Levels that justify injecting `param` into a real request. */
const INJECTING = new Set(['documented', 'verified'])

/**
 * Vendors whose priority tier is documented. `param` is merged into the JSON
 * request body, never invented for an endpoint that is not listed here.
 * @type {ReadonlyArray<{ id: string, hosts: ReadonlyArray<string>, models?: ReadonlyArray<RegExp>, support: string, param: Readonly<Record<string, unknown>>, note: string }>}
 */
export const BUILTIN_RULES = [
  {
    id: 'openai',
    hosts: ['api.openai.com'],
    support: 'documented',
    param: { service_tier: 'priority' },
    note: 'OpenAI documents service_tier=priority for eligible models and organizations.',
  },
  {
    id: 'deepseek',
    hosts: ['api.deepseek.com'],
    support: 'unsupported',
    param: {},
    note: 'The DeepSeek API exposes no priority service tier, so no client can make it generate faster.',
  },
]

/**
 * Unwrap a proxied URL to the endpoint it actually calls.
 *
 * Harness installs commonly route provider traffic through a local relay or
 * proxy (`http://127.0.0.1:PORT/<name>/https://api.vendor.com/v1/...`). Judging
 * capability by the URL the shim sees would classify every such setup as
 * "localhost", so the inner absolute URL wins whenever there is one.
 *
 * @param {string | undefined} url
 * @returns {string}
 */
export function upstreamOf(url) {
  if (typeof url !== 'string' || url === '') return ''
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url)
  if (scheme === null) return url
  const rest = url.slice(scheme[0].length)
  const nested = /^[^/]+\/(?:[^/?#]+\/)*(https?:\/\/\S+)/i.exec(rest)
  return nested === null ? url : nested[1]
}

/**
 * Normalize a base URL or full request URL to a lowercase hostname.
 *
 * For a proxied URL the upstream host is returned, because that is the party
 * whose capability matters.
 *
 * @param {string | undefined} url
 * @returns {string}
 */
export function hostOf(url) {
  if (typeof url !== 'string' || url === '') return ''
  const target = upstreamOf(url)
  try {
    return new URL(target).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * @param {string} host
 * @param {string} wanted
 */
function hostMatches(host, wanted) {
  const target = wanted.toLowerCase()
  return host === target || host.endsWith(`.${target}`)
}

/**
 * @param {string} host
 * @returns {typeof BUILTIN_RULES[number] | undefined}
 */
export function builtinRuleFor(host) {
  if (host === '') return undefined
  return BUILTIN_RULES.find((rule) => rule.hosts.some((wanted) => hostMatches(host, wanted)))
}

/**
 * The verdict key a probe writes and this module reads.
 * @param {string} host
 * @param {string} model
 */
export function verdictKey(host, model) {
  return `${host}|${model}`
}

/**
 * Decide the effective capability for one endpoint and model.
 *
 * Precedence: the user's explicit profile override, then a documented vendor
 * rule, then this plugin's measured verdict, then `unknown`.
 *
 * @param {object} input
 * @param {string | undefined} input.url - request or base URL.
 * @param {string} input.model
 * @param {Record<string, { support?: string, param?: Record<string, unknown>, note?: string }>} [input.overrides]
 * @param {Record<string, { verdict?: string, deltaPct?: number }>} [input.verdicts]
 * @returns {{ support: string, param: Record<string, unknown>, source: string, note: string }}
 */
export function resolveCapability({ url, model, overrides = {}, verdicts = {} }) {
  const host = hostOf(url)
  const override = host !== '' ? overrides[host] ?? overrides[host.replace(/^www\./, '')] : undefined
  if (override !== undefined && typeof override.support === 'string') {
    return {
      support: normalizeSupport(override.support),
      param: plainParam(override.param),
      source: 'profile-override',
      note: typeof override.note === 'string' ? override.note : 'Declared in this profile\'s plugin config.',
    }
  }

  const rule = builtinRuleFor(host)
  if (rule !== undefined) {
    return {
      support: normalizeSupport(rule.support),
      param: plainParam({ ...rule.param }),
      source: `vendor:${rule.id}`,
      note: rule.note,
    }
  }

  const measured = verdicts[verdictKey(host, model)]
  if (measured !== undefined && typeof measured.verdict === 'string') {
    const support = supportForVerdict(measured.verdict)
    const delta = typeof measured.deltaPct === 'number' ? ` (${formatDelta(measured.deltaPct)} first-token latency)` : ''
    return {
      support,
      param: INJECTING.has(support) ? { service_tier: 'priority' } : {},
      source: 'probe',
      note: `${noteForVerdict(measured.verdict)}${delta}`,
    }
  }

  return {
    support: 'unknown',
    param: {},
    source: 'none',
    note: 'This endpoint\'s priority tier is unknown. Run the probe before expecting a speed-up; the plugin will not send an unverified parameter.',
  }
}

/**
 * @param {string} verdict
 */
export function supportForVerdict(verdict) {
  if (verdict === 'accepted-faster') return 'verified'
  if (verdict === 'accepted-no-effect') return 'accepted-no-effect'
  if (verdict === 'rejected') return 'unsupported'
  return 'unknown'
}

/**
 * @param {string} verdict
 */
function noteForVerdict(verdict) {
  if (verdict === 'accepted-faster') return 'The endpoint accepted the priority parameter and answered measurably sooner.'
  if (verdict === 'accepted-no-effect') return 'The endpoint accepted the priority parameter but showed no measurable gain, so Fast stays off here.'
  if (verdict === 'rejected') return 'The endpoint rejected the priority parameter, so it has no such tier.'
  return 'The probe was inconclusive; Fast stays off here until it is re-run.'
}

/**
 * @param {string} support
 */
function normalizeSupport(support) {
  return SUPPORT_LEVELS.includes(/** @type {any} */ (support)) ? support : 'unknown'
}

/**
 * @param {unknown} param
 * @returns {Record<string, unknown>}
 */
function plainParam(param) {
  if (param === null || typeof param !== 'object' || Array.isArray(param)) return {}
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [key, value] of Object.entries(param)) {
    if (typeof key === 'string' && key !== '') out[key] = value
  }
  return out
}

/**
 * Whether a capability justifies touching a real request.
 * @param {{ support: string, param: Record<string, unknown> }} capability
 */
export function injectable(capability) {
  return INJECTING.has(capability.support) && Object.keys(capability.param).length > 0
}

/**
 * @param {number} deltaPct
 */
export function formatDelta(deltaPct) {
  const sign = deltaPct > 0 ? '+' : ''
  return `${sign}${deltaPct.toFixed(1)}%`
}
