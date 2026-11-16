import test from 'node:test'
import assert from 'node:assert/strict'

import { createTransport, DEFAULT_HOLD_MS, MAX_HOLD_MS } from '../lib/tier.js'

const URL_OPENAI = 'https://api.openai.com/v1/chat/completions'
const URL_RELAY = 'http://127.0.0.1:18080/relay/https://relay.example.com/v1/chat/completions'

const DOCUMENTED = {
  support: 'documented',
  param: { service_tier: 'priority' },
  source: 'vendor:openai',
  note: 'documented',
}

function jsonResponse(body = { ok: true }, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers })
}

/**
 * Swap `globalThis.fetch` for a recorder and return what it saw.
 */
function fakeFetch(handler) {
  const calls = []
  const impl = async (input, init) => {
    calls.push({ input, init })
    return handler === undefined ? jsonResponse() : handler(input, init)
  }
  return { impl, calls }
}

/**
 * Acquire a transport over a fake base fetch and always clean up.
 */
async function withTransport({ capability = DOCUMENTED, holdMs, run } = {}) {
  const original = globalThis.fetch
  const fake = fakeFetch()
  globalThis.fetch = fake.impl
  const transport = createTransport({ capabilityFor: () => capability, holdMs })
  transport.acquire()
  try {
    await run({ transport, fake })
  } finally {
    transport.release()
    globalThis.fetch = original
  }
}

function bodyOf(call) {
  return JSON.parse(call.init.body)
}

test('Standard sends the request byte-for-byte unchanged', async () => {
  await withTransport({
    run: async ({ transport, fake }) => {
      const record = {}
      await transport.runIn({ speed: 'standard', record }, () =>
        globalThis.fetch(URL_OPENAI, {
          method: 'POST',
          body: JSON.stringify({ model: 'gpt-4.1', messages: [{ role: 'user', content: 'hi' }] }),
        }),
      )
      assert.equal(record.paramSent, undefined)
      assert.equal(bodyOf(fake.calls[0]).service_tier, undefined)
      assert.equal(transport.status().injected, 0)
    },
  })
})

test('Fast adds only the documented parameter and keeps every other field', async () => {
  await withTransport({
    run: async ({ transport, fake }) => {
      const record = {}
      const payload = {
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'high',
        max_tokens: 512,
        stream: true,
      }
      await transport.runIn({ speed: 'fast', record }, () =>
        globalThis.fetch(URL_OPENAI, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
          body: JSON.stringify(payload),
        }),
      )

      const sent = bodyOf(fake.calls[0])
      assert.deepEqual(sent, { ...payload, service_tier: 'priority' })
      assert.equal(fake.calls[0].init.headers.authorization, 'Bearer test')
      assert.deepEqual(record.paramSent, { service_tier: 'priority' })
      assert.equal(record.paramSource, 'vendor:openai')
      assert.equal(transport.status().injected, 1)
    },
  })
})

test('Fast stays off when the endpoint was measured as unaffected', async () => {
  await withTransport({
    capability: { support: 'accepted-no-effect', param: {}, source: 'probe', note: 'no measurable gain' },
    run: async ({ transport, fake }) => {
      const record = {}
      await transport.runIn({ speed: 'fast', record }, () =>
        globalThis.fetch(URL_RELAY, { method: 'POST', body: JSON.stringify({ model: 'm', messages: [] }) }),
      )
      assert.equal(record.paramSent, undefined)
      assert.equal(record.paramBlocked, 'accepted-no-effect')
      assert.equal(bodyOf(fake.calls[0]).service_tier, undefined)
    },
  })
})

test('an unknown endpoint is never rewritten', async () => {
  await withTransport({
    capability: { support: 'unknown', param: {}, source: 'none', note: 'unknown' },
    run: async ({ transport, fake }) => {
      const record = {}
      await transport.runIn({ speed: 'fast', record }, () =>
        globalThis.fetch(URL_RELAY, { method: 'POST', body: JSON.stringify({ model: 'm', messages: [] }) }),
      )
      assert.equal(record.paramBlocked, 'unknown')
      assert.equal(bodyOf(fake.calls[0]).service_tier, undefined)
      assert.equal(transport.status().injected, 0)
    },
  })
})

test('a caller-supplied tier is respected, not overwritten', async () => {
  await withTransport({
    run: async ({ transport, fake }) => {
      const record = {}
      await transport.runIn({ speed: 'fast', record }, () =>
        globalThis.fetch(URL_OPENAI, {
          method: 'POST',
          body: JSON.stringify({ model: 'gpt-4.1', messages: [], service_tier: 'flex' }),
        }),
      )
      assert.equal(bodyOf(fake.calls[0]).service_tier, 'flex')
      assert.equal(record.paramSent, undefined)
      const last = transport.status().decisions.at(-1)
      assert.equal(last.skipped, 'tier-already-set')
    },
  })
})

test('the probe is allowed to test an undocumented parameter', async () => {
  await withTransport({
    capability: { support: 'unknown', param: {}, source: 'none', note: 'unknown' },
    run: async ({ transport, fake }) => {
      const record = {}
      await transport.runIn({ speed: 'fast', record, probeParam: { service_tier: 'priority' } }, () =>
        globalThis.fetch(URL_RELAY, { method: 'POST', body: JSON.stringify({ model: 'm', messages: [] }) }),
      )
      assert.equal(bodyOf(fake.calls[0]).service_tier, 'priority')
      assert.equal(record.paramSent !== undefined, true)
      assert.equal(record.paramSource, 'probe')
    },
  })
})

test('requests without a session context, or not POST, pass straight through', async () => {
  await withTransport({
    run: async ({ transport, fake }) => {
      await globalThis.fetch(URL_OPENAI, { method: 'POST', body: JSON.stringify({ model: 'gpt-4.1', messages: [] }) })
      const record = {}
      await transport.runIn({ speed: 'fast', record }, () =>
        globalThis.fetch('https://api.openai.com/v1/models', { method: 'GET' }),
      )
      assert.equal(fake.calls.length, 2)
      assert.equal(bodyOf(fake.calls[0]).service_tier, undefined)
      assert.equal(fake.calls[1].init.body, undefined)
      assert.equal(transport.status().injected, 0)
    },
  })
})

test('a 429 holds the next request for Retry-After and never retries by itself', async () => {
  const original = globalThis.fetch
  let call = 0
  const fake = fakeFetch(() => {
    call += 1
    return call === 1
      ? jsonResponse({ error: 'rate limited' }, 429, { 'retry-after': '5' })
      : jsonResponse()
  })
  globalThis.fetch = fake.impl
  const transport = createTransport({ capabilityFor: () => DOCUMENTED, holdMs: 80 })
  transport.acquire()
  try {
    const limited = {}
    await transport.runIn({ speed: 'standard', record: limited }, () =>
      globalThis.fetch(URL_OPENAI, { method: 'POST', body: JSON.stringify({ model: 'gpt-4.1', messages: [] }) }),
    )
    assert.equal(limited.throttled, true)
    assert.equal(limited.retryAfterMs, 80)
    assert.equal(transport.status().holding, true)

    const next = {}
    await transport.runIn({ speed: 'standard', record: next }, () =>
      globalThis.fetch(URL_OPENAI, { method: 'POST', body: JSON.stringify({ model: 'gpt-4.1', messages: [] }) }),
    )
    assert.equal(fake.calls.length, 2, 'no automatic retry of the failed request')
    assert.ok(next.heldMs >= 60, `expected a hold near 80ms, saw ${next.heldMs}`)
    assert.equal(transport.status().held, 1)
  } finally {
    transport.release()
    globalThis.fetch = original
  }
})

test('the shim re-arms when another integration replaces fetch', async () => {
  const original = globalThis.fetch
  const first = fakeFetch()
  globalThis.fetch = first.impl
  const transport = createTransport({ capabilityFor: () => DOCUMENTED })
  transport.acquire()
  try {
    // A later integration wraps fetch and calls the real implementation
    // directly, which would silently bypass an early one-shot shim.
    const bypassed = []
    const realBase = first.impl
    globalThis.fetch = async (input, init) => {
      bypassed.push(input)
      return realBase(input, init)
    }
    assert.equal(transport.status().armed, false)

    await new Promise((resolve) => setTimeout(resolve, 2400))
    assert.equal(transport.status().armed, true, 'watchdog should re-install the shim')

    const record = {}
    await transport.runIn({ speed: 'fast', record }, () =>
      globalThis.fetch(URL_OPENAI, { method: 'POST', body: JSON.stringify({ model: 'gpt-4.1', messages: [] }) }),
    )
    assert.equal(record.paramSent !== undefined, true)
    assert.equal(bypassed.length, 1, 'the third-party fetch is now the base, not a silent bypass')
    assert.equal(bodyOf(first.calls[0]).service_tier, 'priority')
  } finally {
    transport.release()
    globalThis.fetch = original
  }
})

test('hold bounds are exported and sane', () => {
  assert.equal(MAX_HOLD_MS, 15000)
  assert.equal(DEFAULT_HOLD_MS, 2000)
})
