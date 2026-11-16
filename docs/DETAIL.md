# DSH Turbo Mode

Turbo Mode adds a **Standard / Fast** switch to the composer. Fast asks the
model provider for its *real* priority serving tier — the same model, the same
reasoning effort, the same prompt, the same output limits — and then measures
whether the answer actually arrived sooner.

It never fakes speed. If the endpoint has no documented priority tier, Fast
stays off and the switch says why.

## What Fast does

| | Standard | Fast |
| --- | --- | --- |
| Model | your selection | your selection (unchanged) |
| Reasoning effort | your selection | your selection (unchanged) |
| Prompt, tools, temperature, max tokens | unchanged | unchanged |
| Request parameter | none | the provider's documented priority parameter |
| Measured and reported | yes | yes |

The only difference between the two is one extra field in the outgoing request
body, and only when the plugin can prove the endpoint documents that field:

| Endpoint | Fast sends | Evidence |
| --- | --- | --- |
| `api.openai.com` | `service_tier: "priority"` | OpenAI documents priority processing |
| Anything else | nothing until measured | `turbo_mode` tool runs an A/B probe, then records the verdict |
| `api.deepseek.com` | nothing | DeepSeek publishes no priority tier |

Nothing is injected on an unclassified endpoint: "unknown" is not treated as
"probably fine". Run `turbo_mode` with `action: "probe"` to measure a relay:
the plugin alternates plain and priority requests at the same effort and
compares time-to-first-token.

Two rules keep noise out of the verdict:

1. **At least 3 interleaved rounds.** Fewer answers `inconclusive`; one lucky
   round is not evidence (this project measured a +23.6% single-round "win"
   that did not repeat).
2. **Aggregation over history.** The last five probes per endpoint+model are
   kept; of the last three decisive ones, at least **two** must show a ≥15%
   median win with a majority of rounds faster before the endpoint counts as
   verified. All flat → `accepted-no-effect`; split → `unknown`, and Fast stays
   off until the win repeats. Entries written before aggregation existed are
   not trusted; a refusal (HTTP 400/422) is a hard signal and needs no
   statistics.

## Where the setting lives

- The switch applies to **the session on screen**. Unknown/absent session ⇒ the
  profile default, which is what new sessions inherit.
- Preferences persist in `<DSH_HOME>/dsh-turbo/state.json` and survive
  restarts. Measured endpoint verdicts persist in `capability.json`.
- The agent can read and change the same setting through the `turbo_mode` tool,
  so "turn Fast on" works in a prompt too.

## Measurements, not marketing

Every streamed call is timed for time-to-first-token and total duration, and
its reported usage is recorded. `/turbo/metrics` groups the samples by the tier
that was actually requested, so the comparison is like-for-like: same session,
same model, same effort, alternating settings.

The dock shows the median first-token latency and median output rate for the
tier currently selected. When Fast cannot be honoured, the badge is grey rather
than green and the reason is printed.

## Stability

Fast mode is not a way around rate limits. On `429` the plugin reads
`Retry-After` and holds the next request for that window (capped at 15 s) —
it does not retry in a tight loop, does not rotate credentials, and does not
spend extra quota to look fast. Held requests are reported in the UI.

## Removing it

Disable or uninstall the bundle; the fetch shim, the HTTP routes, the tool and
the composer switch are all unregistered with it. The two JSON files under
`<DSH_HOME>/dsh-turbo/` are the plugin's only leftovers and can be deleted by
hand.

## Configuration

```yaml
- insert:
    - id: turbo
      name: dsh-turbo-mode
      config:
        defaultSpeed: standard   # standard | fast, seeds every session
        holdMs: 15000            # longest 429 hold
        metricsCapacity: 200     # samples kept in memory
        probeSamples: 3          # rounds per A/B probe (3..5; fewer never decides)
        dshHome: null            # override the state directory
        providers: {}            # per-endpoint capability overrides
```

Per-endpoint overrides, when a relay documents something the built-in table
does not know:

```yaml
        providers:
          'relay.example.com':
            support: documented
            param: { service_tier: priority }
            note: 'Relay docs: priority processing on request.'
```

Use `support: unsupported` to forbid injection on an endpoint that rejects it.
