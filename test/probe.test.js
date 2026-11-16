import test from 'node:test'
import assert from 'node:assert/strict'

import { runProbe, MAX_SAMPLES, MIN_WIN_PCT, MIN_ROUNDS, PROBE_PARAM } from '../lib/probe.js'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * A stand-in model runtime whose latency depends on the arm the probe chose.
 * It reads the transport context exactly the way the real adapter would be
 * timed, without needing a socket.
 */
function fakeLlm(transport, options = {}) {
  const { standardMs = 40, fastMs = 10, failFast = false, failStandard = false } = options
  return {
    async *stream() {
      const context = transport.current()
      const arm = context?.speed === 'fast' ? 'fast' : 'standard'
      if (arm === 'fast' && failFast) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP_400', status: 400 } } }
        return
      }
      if (arm === 'standard' && failStandard) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP_500', status: 500 } } }
        return
      }
      await sleep(arm === 'fast' ? fastMs : standardMs)
      yield { type: 'text-delta', index: 0, text: 'ok' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

/** The transport is only used for its context; the fake llm never fetches. */
function stubTransport() {
  let context
  return {
    current: () => context,
    status: () => ({ injected: 0, decisions: [] }),
    runIn: (next, fn) => {
      const previous = context
      context = next
      return Promise.resolve()
        .then(fn)
        .finally(() => {
          context = previous
        })
    },
  }
}

test('constants describe a conservative probe', () => {
  assert.deepEqual(PROBE_PARAM, { service_tier: 'priority' })
  assert.equal(MAX_SAMPLES, 5)
  assert.ok(MIN_WIN_PCT >= 10)
  assert.ok(MIN_ROUNDS >= 3, 'a verdict needs several interleaved rounds')
})

test('a clear win is reported as faster with the measured delta', async () => {
  const transport = stubTransport()
  const result = await runProbe({
    llm: fakeLlm(transport, { standardMs: 60, fastMs: 12 }),
    provider: 'test',
    model: 'test-model',
    transport,
    samples: 3,
  })
  assert.equal(result.verdict, 'accepted-faster')
  assert.ok(result.deltaPct > 50, `delta was ${result.deltaPct}`)
  assert.equal(result.samples, 6)
  assert.match(result.detail, /sooner/)
})

test('an indistinguishable result is reported as no effect, not as a win', async () => {
  const transport = stubTransport()
  const result = await runProbe({
    llm: fakeLlm(transport, { standardMs: 20, fastMs: 20 }),
    provider: 'test',
    model: 'test-model',
    transport,
    samples: 3,
  })
  assert.equal(result.verdict, 'accepted-no-effect')
  assert.match(result.detail, /noise floor/)
})

test('a refused parameter is reported as rejected', async () => {
  const transport = stubTransport()
  const result = await runProbe({
    llm: fakeLlm(transport, { failFast: true }),
    provider: 'test',
    model: 'test-model',
    transport,
    samples: 1,
  })
  assert.equal(result.verdict, 'rejected')
  assert.match(result.detail, /refused the priority parameter/)
})

test('a failing baseline makes the probe inconclusive instead of optimistic', async () => {
  const transport = stubTransport()
  const result = await runProbe({
    llm: fakeLlm(transport, { failStandard: true }),
    provider: 'test',
    model: 'test-model',
    transport,
    samples: 1,
  })
  assert.equal(result.verdict, 'inconclusive')
  assert.match(result.detail, /standard arm failed/)
})

test('the probe reports when the parameter never reached the wire', async () => {
  const transport = stubTransport()
  const result = await runProbe({
    llm: fakeLlm(transport, { standardMs: 15, fastMs: 5 }),
    provider: 'test',
    model: 'test-model',
    transport,
    samples: 1,
  })
  assert.match(result.detail, /never reached the wire/)
})

test('the sample count is clamped to the documented maximum', async () => {
  const transport = stubTransport()
  const result = await runProbe({
    llm: fakeLlm(transport, { standardMs: 1, fastMs: 1 }),
    provider: 'test',
    model: 'test-model',
    transport,
    samples: 99,
  })
  assert.equal(result.samples, MAX_SAMPLES * 2)
})

test('a single round refuses to decide', async () => {
  const transport = stubTransport()
  const result = await runProbe({
    llm: fakeLlm(transport, { standardMs: 900, fastMs: 400 }),
    provider: 'test',
    model: 'test-model',
    transport,
    samples: 1,
  })
  assert.equal(result.verdict, 'inconclusive')
  assert.equal(result.rounds, 1)
  assert.match(result.detail, /needs at least 3/)
})
