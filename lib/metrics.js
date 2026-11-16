/**
 * Measured request telemetry.
 *
 * Every number here comes from a real HTTP exchange this process performed:
 * the wall time until response headers, the wall time until the first streamed
 * byte, the wall time until the stream ended, and the usage the provider
 * itself reported. Nothing is estimated except the explicitly named
 * `estimatedTokens` fallback used when a provider sends no usage.
 *
 * @module dsh-turbo-mode/metrics
 */

/** Ring capacity: enough for a percentile over the last few turns. */
const CAPACITY = 200

/**
 * @param {number} value
 * @param {number[]} sorted
 */
function percentile(value, sorted) {
  if (sorted.length === 0) return undefined
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((value / 100) * (sorted.length - 1))))
  return sorted[index]
}

/**
 * @param {number[]} values
 */
function median(values) {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Create the request ring buffer.
 * @param {{ capacity?: number }} [options]
 */
export function createMetrics({ capacity = CAPACITY } = {}) {
  /** @type {import('./types.js').RequestMetric[]} */
  const records = []

  /**
   * @param {import('./types.js').RequestMetric} record
   */
  function push(record) {
    records.push(record)
    if (records.length > capacity) records.splice(0, records.length - capacity)
  }

  /** @param {number} [limit] */
  function list(limit = 50) {
    const start = Math.max(0, records.length - limit)
    return records.slice(start)
  }

  /**
   * Aggregate by tier so Standard and Fast can be compared on the same screen.
   * @param {{ limit?: number }} [options]
   */
  function summary({ limit = capacity } = {}) {
    const slice = list(limit)
    /** @type {Record<string, unknown>} */
    const byTier = {}
    for (const tier of ['standard', 'fast']) {
      const subset = slice.filter((record) => record.speed === tier)
      const ok = subset.filter((record) => record.ok === true)
      const ttft = ok.map((record) => record.firstTokenMs).filter((value) => typeof value === 'number')
      const total = ok.map((record) => record.totalMs).filter((value) => typeof value === 'number')
      const rate = ok.map((record) => record.tokensPerSecond).filter((value) => typeof value === 'number')
      const sortedTtft = [...ttft].sort((a, b) => a - b)
      byTier[tier] = {
        requests: subset.length,
        failures: subset.length - ok.length,
        medianFirstTokenMs: median(ttft),
        p95FirstTokenMs: percentile(95, sortedTtft),
        medianTotalMs: median(total),
        medianTokensPerSecond: median(rate),
      }
    }
    const failures = slice.filter((record) => record.ok !== true)
    return {
      requests: slice.length,
      failures: failures.length,
      retries: slice.filter((record) => record.retried === true).length,
      throttled: slice.filter((record) => record.status === 429).length,
      byTier,
    }
  }

  function clear() {
    records.length = 0
  }

  return { push, list, summary, clear, capacity }
}
