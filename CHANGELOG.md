# Changelog

All notable changes to **dsh-turbo-mode** are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [0.1.0] — 2026-11-16

First release. Package name is `dsh-turbo-mode` (the npm name `dsh-turbo` belongs to an unrelated project).

### Added

- **Per-session Standard / Fast switch** in the composer dock (`conversation.composer.dock`), with persisted preference in `<DSH_HOME>/dsh-turbo/state.json`.
- **Transport-layer tier injection**: on `POST` JSON completion requests, adds the endpoint's documented priority parameter (`service_tier: "priority"` for `api.openai.com`) — and nothing else in the body.
- **Capability resolution** with explicit precedence: profile override → built-in vendor rule → measured probe verdict → `unknown`. Unknown endpoints are never injected into.
- **A/B capability probe** (`turbo_mode` tool, `POST /turbo/probe`): interleaved standard/fast calls at identical effort, comparing time-to-first-token; a win needs ≥15% median improvement plus a majority of faster rounds. Verdicts persist in `capability.json`.
- **Real performance metrics**: TTFT, total duration, tokens/second, per-tier medians and p95, 429 count, retry and hold counts — all from actual HTTP exchanges.
- **429 handling**: honours `Retry-After` (seconds or HTTP date) by holding the next request up to a cap (default 15 s). Delay only — no retry loop, no credential rotation.
- **Self-healing fetch hook**: re-wraps `globalThis.fetch` when another integration replaces it, so Fast is not silently downgraded to Standard.
- **Loopback-only HTTP API**: `/turbo/health`, `/turbo/state`, `/turbo/speed`, `/turbo/metrics`, `/turbo/probe`.
- **Localization**: English and Simplified Chinese UI strings, plus plugin metadata (`locale/meta`).
- **Tests**: 41 `node --test` cases covering capability precedence, state persistence/corruption, metrics, the fetch hook (inject / skip / 429 hold / re-arm) and probe verdicts.

### Measured

- An internal OpenAI-compatible relay (host withheld; model `DeepSeek-V4.1-Flash-1017`): the parameter is **accepted but has no reproducible effect** (median +5.5% over four probes, one 18.5% outlier that did not repeat). Recorded as `accepted-no-effect`; the plugin stops injecting there and the UI says Fast is not effective.
- OpenAI `service_tier=priority` is documented but **was not tested** in this release (no key in the author's profile), so no speed-up is claimed for it.

### Not included (on purpose)

- No prompt engineering, no output-length guidance, no reasoning-effort reduction, no model downgrade.
- No request-concurrency limiter: the plugin delays after a `429`, it does not gate or serialise the Harness loop.
