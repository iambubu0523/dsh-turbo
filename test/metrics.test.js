import test from 'node:test'
import assert from 'node:assert/strict'

import { createMetrics } from '../lib/metrics.js'

function record(overrides) {
  return {
    at: Date.now(),
    host: 'relay.example.com',
    provider: 'relay',
    model: 'DeepSeek-V4.1-Flash-1017',
    speed: 'standard',
    ok: true,
    status: 200,
    firstTokenMs: 1000,
    totalMs: 2000,
    outputTokens: 100,
    tokensPerSecond: 100,
    ...overrides,
  }
}

test('an empty ring reports no numbers instead of zeros', () => {
  const metrics = createMetrics()
  const summary = metrics.summary()
  assert.equal(summary.requests, 0)
  assert.equal(summary.byTier.standard.medianFirstTokenMs, undefined)
  assert.equal(summary.byTier.fast.p95FirstTokenMs, undefined)
})

test('per-tier medians come from the recorded samples', () => {
  const metrics = createMetrics()
  metrics.push(record({ speed: 'standard', firstTokenMs: 1000, totalMs: 2000, tokensPerSecond: 100 }))
  metrics.push(record({ speed: 'standard', firstTokenMs: 2000, totalMs: 3000, tokensPerSecond: 200 }))
  metrics.push(record({ speed: 'fast', firstTokenMs: 500, totalMs: 1200, tokensPerSecond: 300 }))

  const summary = metrics.summary()
  assert.equal(summary.requests, 3)
  assert.equal(summary.byTier.standard.requests, 2)
  assert.equal(summary.byTier.standard.medianFirstTokenMs, 1500)
  assert.equal(summary.byTier.standard.medianTokensPerSecond, 150)
  assert.equal(summary.byTier.fast.medianFirstTokenMs, 500)
  assert.equal(summary.byTier.fast.medianTotalMs, 1200)
})

test('failures are counted per tier and excluded from latency medians', () => {
  const metrics = createMetrics()
  metrics.push(record({ speed: 'fast', firstTokenMs: 900 }))
  metrics.push(record({ speed: 'fast', ok: false, status: 500, firstTokenMs: undefined, totalMs: undefined }))

  const summary = metrics.summary()
  assert.equal(summary.failures, 1)
  assert.equal(summary.byTier.fast.requests, 2)
  assert.equal(summary.byTier.fast.failures, 1)
  assert.equal(summary.byTier.fast.medianFirstTokenMs, 900)
})

test('throttling and retries are surfaced separately', () => {
  const metrics = createMetrics()
  metrics.push(record({ status: 429, ok: false }))
  metrics.push(record({ retried: true }))
  const summary = metrics.summary()
  assert.equal(summary.throttled, 1)
  assert.equal(summary.retries, 1)
})

test('the ring keeps the newest samples and nothing else', () => {
  const metrics = createMetrics({ capacity: 3 })
  for (let index = 0; index < 5; index += 1) metrics.push(record({ firstTokenMs: index + 1 }))
  const listed = metrics.list(10)
  assert.equal(listed.length, 3)
  assert.deepEqual(listed.map((entry) => entry.firstTokenMs), [3, 4, 5])
  assert.equal(metrics.capacity, 3)
})

test('clear empties the ring without changing its identity', () => {
  const metrics = createMetrics()
  metrics.push(record())
  metrics.clear()
  assert.equal(metrics.list().length, 0)
  assert.equal(metrics.summary().requests, 0)
})
