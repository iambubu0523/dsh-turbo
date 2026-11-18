# Changelog

All notable changes to **dsh-turbo-mode** are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added

- `docs/announcements/` — ready-to-post drafts (V2EX, 掘金, Reddit/HN, X) written around the measured numbers instead of a speed claim.
- GitHub issue templates: a bug report that asks for `GET /turbo/state`, and a **Fast lane works on my endpoint** report that asks for a 3-round probe result — the dataset this project is missing.
- README **Feedback** section: what makes a useful report, and why a single round is not accepted as evidence.

## [0.1.0] — 2026-11-16

First release. Package name is `dsh-turbo-mode` (the npm name `dsh-turbo` belongs to an unrelated project).

### Added

- **Per-session Standard / Fast switch** in the composer dock (`conversation.composer.dock`), with persisted preference in `<DSH_HOME>/dsh-turbo/state.json`.
- **Transport-layer tier injection**: on `POST` JSON completion requests, adds the endpoint's documented priority parameter (`service_tier: "priority"` for `api.openai.com`) — and nothing else in the body.
- **Capability resolution** with explicit precedence: profile override → built-in vendor rule → measured probe verdict → `unknown`. Unknown endpoints are never injected into.
- **A/B capability probe** (`turbo_mode` tool, `POST /turbo/probe`): interleaved standard/fast calls at identical effort, comparing time-to-first-token; a win needs ≥15% median improvement plus a majority of faster rounds.
- **No verdict from a single round**: fewer than 3 interleaved rounds answers `inconclusive`, and verdicts are aggregated over the last three decisive probes — at least two must agree before an endpoint counts as verified. A measured +23.6% single-round "win" that did not repeat is what motivated this rule.
- **Real performance metrics**: TTFT, total duration, tokens/second, per-tier medians and p95, 429 count, retry and hold counts — all from actual HTTP exchanges.
- **429 handling**: honours `Retry-After` (seconds or HTTP date) by holding the next request up to a cap (default 15 s). Delay only — no retry loop, no credential rotation.
- **Self-healing fetch hook**: re-wraps `globalThis.fetch` when another integration replaces it, so Fast is not silently downgraded to Standard. `transport.delivering` reports whether requests actually still reach the hook (a proxy wrapped above us that delegates down keeps Fast working even when `armed` is false).
- **Loopback-only HTTP API**: `/turbo/health`, `/turbo/state`, `/turbo/speed`, `/turbo/metrics`, `/turbo/probe`.
- **Localization**: English and Simplified Chinese UI strings, plus plugin metadata (`locale/meta`).
- **Tests**: 46 `node --test` cases covering capability precedence, verdict aggregation, state persistence/corruption, metrics, the fetch hook (inject / skip / 429 hold / re-arm / delivery), probe verdicts, and cross-model benchmarking (`runBench`).

### Measured

- The author's own OpenAI-compatible relay (host withheld): two models tested. `DeepSeek-V4.1-Flash-1017` — parameter **accepted but no reproducible effect** (8 probes, median +5.5%). `DeepSeek-V4-Pro` — 3 probes disagree (+15.4% / −236.9% / +9.3%), latency variance too high, aggregation rules refuse to decide. Fast stays off for both.
- OpenAI `service_tier=priority` is documented but **was not tested** in this release (no key in the author's profile), so no speed-up is claimed for it.

### Not included (on purpose)

- No prompt engineering, no output-length guidance, no reasoning-effort reduction, no model downgrade.
- No request-concurrency limiter: the plugin delays after a `429`, it does not gate or serialise the Harness loop.
