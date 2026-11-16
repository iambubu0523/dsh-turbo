# 🚀 DSH Turbo Mode

> Codex-style Fast Mode for DeepSeek Harness — buy speed from the **provider's priority tier**, never by lowering reasoning effort, shortening output, or switching models.

[中文](./README.md) | [Measured results](./docs/BENCHMARKS.md)

---

## Honest up front

This plugin does three things:

1. a per-session **Standard / Fast** switch;
2. on endpoints that *actually publish* a priority tier, it adds the provider's documented parameter (for example `service_tier: "priority"`) to the real request;
3. it **measures** whether that made anything faster, and reports the result as it is.

It cannot make a provider without a priority lane become faster. Measured on the author's machine:

| Endpoint | Model | Result |
| --- | --- | --- |
| An internal OpenAI-compatible relay (host withheld) | `DeepSeek-V4.1-Flash-1017` | parameter accepted, **no reproducible speed-up** (four 3-round probes: +18.5% / +1.3% / +5.2% / +5.9%, median +5.5%, i.e. noise) |
| OpenAI (`api.openai.com`) | — | `service_tier=priority` is documented, **not tested here** (no key in this profile) |
| DeepSeek (`api.deepseek.com`) | — | vendor publishes no priority tier, so nothing is sent |

So this is not a magic "make it faster" button. It is: *if the provider has a fast lane, use it — and tell the truth about whether it helped.* Full data and method: [docs/BENCHMARKS.md](./docs/BENCHMARKS.md).

---

## What it does

A small switch appears in the composer:

```
Turbo   [ Standard ] [ Fast ]   first token 1204ms · 198 tok/s
```

- **Standard** — the request goes out byte-for-byte unchanged.
- **Fast** — adds exactly one documented field, and only on an endpoint whose priority tier is confirmed. Model, reasoning effort, prompt, tools, temperature, max tokens and every verification step stay the same. If the endpoint is unsupported, unmeasured, or measured-without-effect, Fast stays off and the reason is printed next to it.

### What it never does

- ❌ no system-prompt tricks, no "write less" guidance (that would trade quality for speed)
- ❌ no `reasoningEffort` changes, no shortened thinking
- ❌ no switching to a cheaper model
- ❌ no skipped validation steps
- ❌ no fabricated numbers, no pretending a speed-up happened
- ❌ no key rotation, no rate-limit evasion, no infinite retries

---

## Install

DSH plugins install as a **bundle**; requires DSH ≥ 0.2.2.

1. Put this directory anywhere (e.g. `~/plugins/dsh-turbo-mode`).
2. Install that directory from the DSH **Plugins** panel; on the host side this is `plugin_manager`'s `install_bundle` with the directory's absolute path as target.
   > The package name is **`dsh-turbo-mode`**. An unrelated `dsh-turbo` package already exists on npm — do not mix them up.
3. No restart needed: the Turbo switch shows up under the composer. If it does not, toggle the bundle off and on in the Plugins panel to hot-reload.

Verified result on the author's machine: `application: "applied"`, `warnings: []`.

### Uninstall

Disable or remove the bundle in the Plugins panel. The HTTP routes, the fetch hook, the `turbo_mode` tool and the composer switch are unregistered together. The only leftovers are two JSON files under `<DSH_HOME>/dsh-turbo/`, which you can delete by hand.

---

## Usage

- **Click the switch** — applies to the session on screen; with no session selected it changes the profile default that new sessions inherit.
- **Ask the agent** — "turn Fast on" makes it call the `turbo_mode` tool (`action: status | set | metrics | probe`).
- **Probe a relay** — `turbo_mode` with `action: "probe"`. Same model, same reasoning effort, one tiny prompt, standard and fast **interleaved** N times each, comparing time-to-first-token. Only a ≥15% median win with a majority of rounds faster marks the endpoint as usable.
- **Read the numbers** — `GET /turbo/state`, `GET /turbo/metrics` (loopback only).

### Supported endpoints

| Endpoint | Behaviour |
| --- | --- |
| `api.openai.com` (and subdomains) | sends `service_tier: "priority"` (documented by OpenAI) |
| `api.deepseek.com` | sends nothing (no such tier) |
| anything else, including OpenAI-compatible relays | nothing until probed; nothing again once a probe shows no effect |
| an endpoint you declare in config | follows your declaration |

An unknown endpoint is never guessed into. `unknown` is not treated as "probably fine".

---

## Configuration

The package ships sane defaults in its own `cordis.patch.yml`. To override, add a same-id block to the **profile**'s `cordis.patch.yml`:

```yaml
- id: turbo
  name: dsh-turbo-mode
  config:
    defaultSpeed: standard      # standard | fast, seeds new sessions
    holdMs: 15000               # longest 429 hold
    metricsCapacity: 200        # samples kept in memory
    probeSamples: 3             # probe rounds (max 5)
    dshHome: null               # override the state directory
    providers: {}               # per-endpoint capability declarations
```

When a relay documents something the built-in table does not know:

```yaml
    providers:
      'relay.example.com':
        support: documented
        param: { service_tier: priority }
        note: 'relay docs: priority processing on request'
```

Use `support: unsupported` to forbid injection on an endpoint that rejects it.

---

## How it works

The Harness loop deep-freezes request options before sending, and the LLM call config has no slot for provider-private parameters. So the parameter has to be added at the **serialized HTTP layer**:

```
Harness loop → llm/stream (measurement only, request untouched)
             → adapter → fetch hook
                          ├─ session on Standard → pass through untouched
                          ├─ session on Fast and endpoint confirmed → add one field to the body
                          └─ otherwise → pass through, record why
```

- Session ownership travels through `AsyncLocalStorage`, so concurrent sessions never leak into each other's tier.
- The fetch hook re-checks every 2 s and re-wraps if another integration (a local relay proxy, for instance) replaced `globalThis.fetch` — otherwise Fast would silently downgrade to Standard. That was a real bug found in this project, and it is covered by a unit test.

### What the numbers mean

All of them come from real HTTP exchanges; none are estimated:

- **TTFT** — wall time from sending the request to the first `text-delta` / `reasoning-delta`.
- **tok/s** — `usage.outputTokens ÷ generation time`.
- **total** — until the stream ends.
- **throttled / retried / held** — 429 count, retry marks, and how often a request deliberately waited to honour `Retry-After`.

---

## Stability

- **429** — reads `Retry-After` (seconds or HTTP date) and holds the next request for that window, capped by `holdMs` (default 15 s). **Delay only: no retry loop, no credential rotation, no concurrent hammering.**
- It registers no desktop-control capability and does not touch DSH's desktop-operation safety rules.
- Timers/injection run inside `try/finally` and always release the upstream stream (`iterator.return()`), so an aborted turn cannot leave a socket dangling.

---

## Development

Zero dependencies, zero build, plain ESM:

```bash
node --test "test/**/*.test.js"     # 41 cases
```

Covers capability precedence, state persistence and corrupt-state recovery, metric aggregation, the fetch hook (inject / do-not-inject / 429 hold / self-healing) and probe verdicts (including detection of "the parameter never reached the wire").

## Limitations

- A client cannot speed up server-side token generation; the provider must offer a priority queue.
- First-token latency is noisy on a shared network, so the probe's 15% threshold is deliberately conservative — which is why every measurement is stored in `capability.json` instead of being claimed in prose.
- If a relay "accepts but ignores" the tier parameter, this plugin reports it as **no effect**, not as a win.

## Credits

- [dsh-relay-fast](https://github.com/Rock-ql/dsh-relay-fast) — the original `service_tier` injection approach
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the Cordis plugin framework

## License

MIT — see [LICENSE](./LICENSE).
