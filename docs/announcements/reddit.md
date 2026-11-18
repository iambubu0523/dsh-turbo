# Reddit / Hacker News 发布稿 (English)

> Subreddit: **r/LocalLLaMA** (primary) or **r/LLMDevs**. Do not cross-post the same day.
> Tone: technical, self-deprecating, no marketing. LocalLLaMA hates "I made an amazing tool" posts.

## Title

```
I added service_tier: "priority" to every request for two weeks. My own A/B tests say it did nothing.
```

## Body

```text
Short version: I built a Fast Mode for DeepSeek Harness (DSH), ran 8 interleaved A/B probes against my own
OpenAI-compatible relay, and the honest result is "+5.5% median, inside the noise". I shipped it anyway,
because the interesting part turned out to be the measurement, not the speedup.

Why not the obvious approaches:

- Prompt-tuning the model to "be brief" -> faster-looking, but it just writes less. Not a speedup.
- Auto-dropping reasoning effort -> faster, and quietly worse on hard tasks.
- Swapping to a smaller model -> not the same model anymore.

The only mechanism that keeps model, reasoning effort and output length identical is asking the
*server* for a higher queue priority. OpenAI documents `service_tier: "priority"` for exactly that.

The catch in DSH: requests are deep-frozen before they reach a plugin, so the parameter can't be
added at the request-object layer. It has to go in after JSON serialization, i.e. in a `fetch` hook.
One field, nothing else touched. If the caller already set `service_tier`, respect it.

Then the hard question: did it help?

My first probe said +23.6%. I flipped the endpoint to "verified" and started injecting.
Three reruns, same minute, same model: -7.8%, -0.1%, +9.7%.

So the +23.6% was noise. Median across 8 probes: +5.5%. The parameter was **accepted** (no 400/422),
the server just didn't act on it. That is the normal state of affairs for most relays.

Three rules came out of that, and they are now enforced in code:

1. A single round never produces a verdict. `samples < 3` returns `inconclusive`, and the message says
   how much faster that one round was, so you can see what you're throwing away.
2. Verdicts aggregate history: last 5 probes per `host|model`, take the last 3 decisive ones;
   `verified` requires >=2 of them faster by >=15%. All slow -> `accepted-no-effect`.
   One fast, one slow -> `unknown`, and Fast stays OFF until a speedup repeats.
3. 400/422 is a hard signal: never retried, never reconsidered.

What it actually does today:

- Per-session Standard/Fast toggle in the composer, plus a `turbo_mode` tool so an agent can flip it.
- Injects `service_tier: "priority"` only where the provider documents it (OpenAI) or where the
  aggregate probe says it repeats.
- Real TTFT and tok/s measured from the stream, not inferred from total time / token count.
- 429: honours `Retry-After` (seconds or HTTP-date) and holds the next request. No retries, no key
  rotation, no hammering.

What it explicitly does not do: prompt engineering, reasoning downgrade, output shortening, model
swapping, concurrency tricks that dodge rate limits.

Install (no npm account needed, DSH resolves git specs):  github:iambubu0523/dsh-turbo
Repo: https://github.com/iambubu0523/dsh-turbo  (MIT, zero deps, zero build, 46 tests)

If you run it against OpenAI's real priority tier or a relay you know enables it, I'd like the probe
numbers — right now the repo has exactly one data point and it's mine.
```

## HN variant

Same body, but HN needs the "Show HN:" prefix and a shorter opener:

```
Show HN: A Fast Mode that tells you when your endpoint has no fast lane
```

First comment to post immediately (HN convention):

```text
Author here. The numbers in the README are the boring ones on purpose: 8 probes, median +5.5%,
best single round +23.6%, and that best round never reproduced. The plugin's default state against
my relay is "accepted-no-effect", meaning: parameter accepted, server ignored it.

I built the measurement first because my own first version believed a single +23.6% round.
```

## Notes

- Don't say "revolutionary", "blazing", "10x". Reddit will eat you alive.
- Don't include the relay's real host; "my own OpenAI-compatible relay" is enough.
- Reply to "so it doesn't work?" with: it works as a detector; the speedup depends on your provider.
