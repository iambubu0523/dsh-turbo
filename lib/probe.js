/**
 * The capability probe: does this endpoint really answer sooner when asked for
 * a priority tier?
 *
 * The probe sends the same tiny request twice per round — once with the
 * parameter, once without — through the ordinary Harness stream path, so it
 * exercises the same adapter, credentials, and endpoint a real turn would. It
 * compares time-to-first-token, which is the part of a turn a server-side
 * priority tier can actually move.
 *
 * It is deliberately conservative: a speed-up is only reported when the fast
 * arm wins by a margin far larger than the spread of its own samples. A
 * no-effect result is a real, useful answer and is reported as such.
 *
 * @module dsh-turbo-mode/probe
 */

/** Never spend more than this many samples per arm. */
const MAX_SAMPLES = 5

/** A win smaller than this is inside the noise of a shared network path. */
const MIN_WIN_PCT = 15

/** The parameter under test. Only OpenAI documents one today. */
const PROBE_PARAM = { service_tier: 'priority' }

const PROBE_PROMPT = 'Reply with the single word: ok'

/**
 * @param {number[]} values
 * @returns {number | undefined}
 */
function median(values) {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * One tiny model call; resolves with its time to first token.
 * @param {object} options
 * @param {any} options.llm
 * @param {string} options.provider
 * @param {string} options.model
 * @param {string} [options.effort]
 * @param {ReturnType<import('./tier.js').createTransport>} options.transport
 * @param {'standard' | 'fast'} options.speed
 * @param {boolean} options.withParam
 * @returns {Promise<{ firstTokenMs?: number, totalMs?: number, failure?: { code: string, status?: number }, paramSent?: boolean }>}
 */
async function oneCall({ llm, provider, model, effort, transport, speed, withParam }) {
  /** @type {Record<string, any>} */
  const record = {}
  /** @type {any} */
  const options = {
    provider,
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: PROBE_PROMPT }] }],
    // Enough for a one-word answer plus a little slack; the probe measures
    // latency, not throughput, so this keeps the cost of the test negligible.
    maxTokens: 32,
  }
  if (typeof effort === 'string' && effort !== '') options.reasoningEffort = effort

  const started = performance.now()
  const before = transport.status()
  const injectedBefore = before.injected
  const decisionsBefore = before.decisions?.length ?? 0
  let firstTokenMs
  let totalMs
  let failure

  await transport.runIn({ speed, record, probeParam: withParam ? PROBE_PARAM : undefined }, async () => {
    for await (const chunk of llm.stream(options)) {
      if (firstTokenMs === undefined && (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta')) {
        firstTokenMs = performance.now() - started
      }
      if (chunk.type === 'finish') {
        totalMs = performance.now() - started
        if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') {
          failure = chunk.reason.failure ?? { code: 'ERROR' }
        }
        break
      }
    }
  })

  const paramSent =
    record.paramSent !== undefined || transport.status().injected > injectedBefore
  const sawDecision = (transport.status().decisions?.length ?? 0) > decisionsBefore
  return { firstTokenMs, totalMs, failure, paramSent, sawDecision }
}

/**
 * @param {object} options
 * @param {any} options.llm
 * @param {string} options.provider
 * @param {string} options.model
 * @param {string} [options.effort]
 * @param {ReturnType<import('./tier.js').createTransport>} options.transport
 * @param {number} [options.samples]
 * @returns {Promise<import('./types.js').ProbeResult>}
 */
export async function runProbe({ llm, provider, model, effort, transport, samples = 3 }) {
  const rounds = Math.max(1, Math.min(MAX_SAMPLES, Math.trunc(samples) || 3))

  /** @type {number[]} */
  const standard = []
  /** @type {number[]} */
  const fast = []
  /** @type {any[]} */
  const failures = []
  let fastParamSent = false
  /** @type {Array<Record<string, any>>} */
  const calls = []

  for (let round = 0; round < rounds; round += 1) {
    // Interleaved, not blocked: a slow minute on the network then hits both arms
    // instead of whichever arm ran second.
    const baseline = await oneCall({ llm, provider, model, effort, transport, speed: 'standard', withParam: false })
    if (baseline.failure !== undefined) {
      failures.push({ arm: 'standard', ...baseline.failure })
    } else if (baseline.firstTokenMs !== undefined) {
      standard.push(baseline.firstTokenMs)
    }

    const candidate = await oneCall({ llm, provider, model, effort, transport, speed: 'fast', withParam: true })
    if (candidate.failure !== undefined) {
      failures.push({ arm: 'fast', ...candidate.failure })
    } else if (candidate.firstTokenMs !== undefined) {
      fast.push(candidate.firstTokenMs)
    }
    if (candidate.paramSent === true) fastParamSent = true
    calls.push({ arm: 'standard', ...baseline }, { arm: 'fast', ...candidate })
  }

  const standardMedian = median(standard)
  const fastMedian = median(fast)
  const result = /** @type {import('./types.js').ProbeResult} */ ({
    verdict: 'inconclusive',
    host: '',
    model,
    samples: standard.length + fast.length,
    standardMedianMs: standardMedian,
    fastMedianMs: fastMedian,
  })

  const rejected = failures.find(
    (entry) => entry.arm === 'fast' && (entry.status === 400 || entry.status === 422 || entry.code === 'HTTP_400'),
  )

  if (rejected !== undefined) {
    result.verdict = 'rejected'
    result.detail = `The endpoint refused the priority parameter (${rejected.code}${rejected.status ? ` ${rejected.status}` : ''}).`
    return result
  }

  if (standardMedian === undefined || fastMedian === undefined) {
    result.verdict = 'inconclusive'
    const first = failures[0]
    result.detail =
      first === undefined
        ? 'No usable samples; the model produced no token before finishing.'
        : `The ${first.arm} arm failed with ${first.code}${first.status ? ` ${first.status}` : ''}.`
    return result
  }

  const deltaPct = ((standardMedian - fastMedian) / standardMedian) * 100
  result.deltaPct = deltaPct

  const wins = []
  for (let index = 0; index < Math.min(standard.length, fast.length); index += 1) {
    wins.push(fast[index] < standard[index])
  }
  const consistent = wins.filter(Boolean).length >= Math.ceil(wins.length / 2)

  if (deltaPct >= MIN_WIN_PCT && consistent) {
    result.verdict = 'accepted-faster'
    result.detail = `Fast reached the first token ${deltaPct.toFixed(1)}% sooner across ${wins.length} interleaved rounds.`
  } else {
    result.verdict = 'accepted-no-effect'
    result.detail =
      deltaPct > 0
        ? `The parameter was accepted but moved the first token by only ${deltaPct.toFixed(1)}%, inside this probe's noise floor.`
        : 'The parameter was accepted but the fast arm was not measurably sooner.'
  }
  if (fastParamSent === false) result.detail += ' (The parameter never reached the wire; check the endpoint host.)'
  result.calls = calls
  return result
}

export { MIN_WIN_PCT, MAX_SAMPLES, PROBE_PARAM }
