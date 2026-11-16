import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SPEEDS,
  SUPPORT_LEVELS,
  aggregateVerdicts,
  builtinRuleFor,
  formatDelta,
  hostOf,
  injectable,
  resolveCapability,
  supportForVerdict,
  upstreamOf,
  verdictKey,
} from '../lib/capability.js'

const RELAY = 'http://127.0.0.1:18080/relay/https://relay.example.com/v1/chat/completions'

test('SPEEDS and SUPPORT_LEVELS stay a stable contract for the client', () => {
  assert.deepEqual([...SPEEDS], ['standard', 'fast'])
  assert.deepEqual([...SUPPORT_LEVELS], ['documented', 'verified', 'accepted-no-effect', 'unsupported', 'unknown'])
})

test('upstreamOf unwraps a local relay prefix', () => {
  assert.equal(upstreamOf(RELAY), 'https://relay.example.com/v1/chat/completions')
  assert.equal(
    upstreamOf('https://api.openai.com/v1/chat/completions'),
    'https://api.openai.com/v1/chat/completions',
  )
  assert.equal(upstreamOf(''), '')
  assert.equal(upstreamOf(undefined), '')
})

test('hostOf judges the party whose capability matters, not the relay', () => {
  assert.equal(hostOf(RELAY), 'relay.example.com')
  assert.equal(hostOf('https://api.openai.com/v1/chat/completions'), 'api.openai.com')
  assert.equal(hostOf('http://127.0.0.1:9999/v1/chat/completions'), '127.0.0.1')
  assert.equal(hostOf('not a url'), '')
})

test('builtinRuleFor only claims vendors with a documented tier', () => {
  const openai = builtinRuleFor('api.openai.com')
  assert.equal(openai?.support, 'documented')
  assert.deepEqual(openai?.param, { service_tier: 'priority' })

  assert.equal(builtinRuleFor('api.deepseek.com')?.support, 'unsupported')
  assert.deepEqual(builtinRuleFor('api.deepseek.com')?.param, {})

  assert.equal(builtinRuleFor('relay.example.com'), undefined)
  assert.equal(builtinRuleFor(''), undefined)
})

test('subdomains inherit a vendor rule, look-alikes do not', () => {
  assert.equal(builtinRuleFor('eu.api.openai.com')?.id, 'openai')
  assert.equal(builtinRuleFor('api.openai.com.evil.test'), undefined)
})

test('resolveCapability precedence: override, vendor, probe, unknown', () => {
  const overridden = resolveCapability({
    url: RELAY,
    model: 'any',
    overrides: { 'relay.example.com': { support: 'verified', param: { service_tier: 'priority' } } },
    verdicts: { [verdictKey('relay.example.com', 'any')]: { verdict: 'rejected' } },
  })
  assert.equal(overridden.source, 'profile-override')
  assert.equal(overridden.support, 'verified')

  const vendor = resolveCapability({ url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1' })
  assert.equal(vendor.source, 'vendor:openai')
  assert.deepEqual(vendor.param, { service_tier: 'priority' })
  assert.equal(injectable(vendor), true)

  const measured = resolveCapability({
    url: RELAY,
    model: 'DeepSeek-V4.1-Flash-1017',
    verdicts: {
      [verdictKey('relay.example.com', 'DeepSeek-V4.1-Flash-1017')]: { verdict: 'accepted-faster', support: 'verified', deltaPct: 22.4 },
    },
  })
  assert.equal(measured.source, 'probe')
  assert.equal(measured.support, 'verified')
  assert.match(measured.note, /\+22\.4% first-token latency/)
  assert.equal(injectable(measured), true)

  const unevaluated = resolveCapability({ url: 'https://example.test/v1/chat/completions', model: 'm' })
  assert.equal(unevaluated.support, 'unknown')
  assert.equal(unevaluated.source, 'none')
})

test('an endpoint the probe measured as unaffected is never injected into', () => {
  const capability = resolveCapability({
    url: RELAY,
    model: 'DeepSeek-V4.1-Flash-1017',
    verdicts: {
      [verdictKey('relay.example.com', 'DeepSeek-V4.1-Flash-1017')]: { verdict: 'accepted-no-effect', support: 'accepted-no-effect', deltaPct: 5.2 },
    },
  })
  assert.equal(capability.support, 'accepted-no-effect')
  assert.deepEqual(capability.param, {})
  assert.equal(injectable(capability), false)
  assert.match(capability.note, /no measurable gain/)
})

test('a rejected or inconclusive probe never becomes injectable', () => {
  assert.equal(supportForVerdict('rejected'), 'unsupported')
  assert.equal(supportForVerdict('inconclusive'), 'unknown')
  assert.equal(supportForVerdict('accepted-faster'), 'verified')
  assert.equal(supportForVerdict('accepted-no-effect'), 'accepted-no-effect')
})

test('injectable requires both a trusted support level and a real parameter', () => {
  assert.equal(injectable({ support: 'documented', param: { service_tier: 'priority' } }), true)
  assert.equal(injectable({ support: 'verified', param: { service_tier: 'priority' } }), true)
  assert.equal(injectable({ support: 'documented', param: {} }), false)
  assert.equal(injectable({ support: 'unsupported', param: { service_tier: 'priority' } }), false)
  assert.equal(injectable({ support: 'unknown', param: { service_tier: 'priority' } }), false)
})

test('verdictKey and formatDelta shape the stored measurement', () => {
  assert.equal(verdictKey('relay.example.com', 'm'), 'relay.example.com|m')
  assert.equal(formatDelta(18.52), '+18.5%')
  assert.equal(formatDelta(-3), '-3.0%')
})

test('an unaggregated earlier verdict is not trusted', () => {
  // Entries written before verdict aggregation carry a bare verdict. A single
  // round must not be able to switch Fast on, so these stay unknown.
  const legacy = resolveCapability({
    url: RELAY,
    model: 'DeepSeek-V4.1-Flash-1017',
    verdicts: {
      [verdictKey('relay.example.com', 'DeepSeek-V4.1-Flash-1017')]: { verdict: 'accepted-faster', deltaPct: 19.1 },
    },
  })
  assert.equal(legacy.support, 'unknown')
  assert.match(legacy.note, /not aggregated/)
  assert.equal(injectable(legacy), false)

  // A refusal is a hard signal and is honoured without statistics.
  const refused = resolveCapability({
    url: RELAY,
    model: 'DeepSeek-V4.1-Flash-1017',
    verdicts: {
      [verdictKey('relay.example.com', 'DeepSeek-V4.1-Flash-1017')]: { verdict: 'rejected', deltaPct: 0 },
    },
  })
  assert.equal(refused.support, 'unsupported')
  assert.equal(injectable(refused), false)
})

test('verdicts are aggregated so one lucky round cannot promote an endpoint', () => {
  const faster = { verdict: 'accepted-faster', deltaPct: 20 }
  const flat = { verdict: 'accepted-no-effect', deltaPct: 2 }

  const notEnough = aggregateVerdicts([faster])
  assert.equal(notEnough.support, 'unknown')
  assert.equal(notEnough.verdict, 'inconclusive')

  const repeatable = aggregateVerdicts([faster, flat, faster])
  assert.equal(repeatable.support, 'verified')
  assert.equal(repeatable.verdict, 'accepted-faster')
  assert.match(repeatable.note, /2 of the last 3/)

  const noGain = aggregateVerdicts([flat, flat, faster])
  assert.equal(noGain.support, 'unknown')
  assert.match(noGain.note, /disagree/)

  const neverFaster = aggregateVerdicts([flat, flat])
  assert.equal(neverFaster.support, 'accepted-no-effect')

  // Only the three most recent entries count, and only decisive ones.
  const stale = aggregateVerdicts([faster, faster, flat, flat, flat])
  assert.equal(stale.support, 'accepted-no-effect')
})
