# Reddit / Hacker News 发布稿 (English)

> 目标版块：**r/LocalLLaMA**（首选），隔天可再发 **r/LLMDevs**。同一天不要交叉发同一个帖。
> 语气：技术、自嘲、零营销。LocalLLaMA 最恨 "I made an amazing tool" 的开场。
> 新账号预热：先在版块里认真回 2–3 个帖子攒点 karma，再发这个帖，否则可能被 automod 直接删。

## 注册与发帖入口

- 注册：https://www.reddit.com/register
- 版块：https://www.reddit.com/r/LocalLLaMA/
- 发帖：https://www.reddit.com/r/LocalLLaMA/submit

## Title（任选一个）

**A（推荐，最像真人复盘）**

```
I added service_tier: "priority" to every request for two weeks. My A/B tests say it did nothing.
```

**B（更技术向）**

```
Eight interleaved A/B probes: service_tier "priority" was accepted by my relay and ignored by it
```

## Body

```text
TL;DR — I built a Fast Mode for DeepSeek Harness (DSH), ran 8 interleaved A/B probes against my own
OpenAI-compatible relay, and the honest result is a +5.5% median in first-token latency: inside the
noise. I shipped it anyway, because the useful part turned out to be the measurement, not the speedup.

Why not the three obvious ways to "go faster":

- Prompt-tuning the model to "be brief" -> looks faster, but it just writes less. Not a speedup.
- Dropping reasoning effort automatically -> faster, and quietly worse on hard tasks.
- Swapping to a smaller model -> it is not the same model anymore.

The only mechanism that keeps model, reasoning effort and output length identical is asking the
server for a higher queue priority. OpenAI documents `service_tier: "priority"` for exactly that.

The catch in DSH: requests are deep-frozen before a plugin ever sees them, so the field cannot be
added at the request-object layer. It has to go in after JSON serialization, i.e. in a fetch hook.
One field, nothing else touched; if the caller already set `service_tier`, respect it.

How I measured (so you can tell me it's wrong):

- Same model, same reasoning effort, same prompt ("Reply with the single word: ok"), max_tokens 32.
- standard and fast arms interleaved inside the same minute, round-robin, 3 rounds per probe.
- TTFT = time to the first `text-delta` on the stream, not total time divided by token count.
- Every fast-arm request asserts the parameter actually reached the wire, so "no effect" can't be
  confused with "never sent".

Then the hard question: did it help?

My first single-round probe said +23.6%. I flipped the endpoint to "verified" and started injecting.
Three reruns, same minute, same model: -7.8%, -0.1%, +9.7%.

So the +23.6% was noise. Median over 8 probes: +5.5%. The parameter was accepted (no 400/422) and
the server did nothing with it. My guess is that is the normal state of affairs for most relays.

Three rules came out of that, now enforced in code:

1. A single round never produces a verdict. `samples < 3` returns `inconclusive`, and the message
   says how much faster that one round was, so you can see what you are throwing away.
2. Verdicts aggregate history: last 5 probes per `host|model`, take the last 3 decisive ones;
   `verified` needs >=2 of them faster by >=15%. All slow -> `accepted-no-effect`.
   One fast, one slow -> `unknown`, and Fast stays OFF until a speedup repeats.
3. 400/422 is a hard signal: never retried, never reconsidered.

What it does today:

- Per-session Standard/Fast toggle in the composer, plus a `turbo_mode` tool an agent can call.
- Injects `service_tier: "priority"` only where the provider documents it (OpenAI) or where the
  aggregate probe says the speedup repeats.
- Real TTFT and tok/s measured off the stream.
- 429: honours `Retry-After` (seconds or HTTP-date) and holds the next request. No retries, no key
  rotation, no hammering. (I also found out the hard way that another proxy had wrapped
  globalThis.fetch above mine, so I added a 2s self-heal and split "armed" from "delivering".)

It explicitly does not do: prompt engineering, reasoning downgrade, output shortening, model
swapping, or concurrency tricks that dodge rate limits.

Install (no npm account needed, DSH resolves git specs): github:iambubu0523/dsh-turbo
Repo: https://github.com/iambubu0523/dsh-turbo  (MIT, zero deps, zero build, 46 tests)

What I'd actually like: if you run it against OpenAI's real priority tier, or a relay you know
enables it, please paste the probe numbers. Right now the repo has exactly one data point and it
is mine, on an endpoint that does not have a fast lane at all.
```

## HN variant

Same body, but HN needs the `Show HN:` prefix and a shorter opener:

```
Show HN: A Fast Mode that tells you when your endpoint has no fast lane
```

First comment to post immediately (HN convention — the author comment is expected):

```text
Author here. The numbers in the README are the boring ones on purpose: 8 probes, median +5.5%,
best single round +23.6%, and that best round never reproduced.

The plugin's default state against my relay is "accepted-no-effect", which means: parameter accepted,
server ignored it. It will say the same about your endpoint unless the probe repeats.

I built the measurement first because my own first version believed a single +23.6% round.
```

## Reply templates（发帖后一小时内守着回评论，Reddit 很看重这个）

**"so it doesn't work?"**

```
It works as a detector. Whether it makes anything faster depends entirely on your provider: OpenAI
documents a priority tier, most relays just accept the field and ignore it. The plugin's job is to
tell you which one you are on instead of guessing.
```

**"this is just a header, why a plugin"**

```
Because the request object is deep-frozen by the harness, so a header/field cannot be added upstream
of serialization. A fetch hook was the only place left. The plugin part is 90% measurement and
verdicts, 10% injection.
```

**"5.5% is nothing, you shipped a placebo"**

```
Agreed, +5.5% median on 8 probes is noise, which is why it does not inject on my endpoint — it is
sitting at accepted-no-effect and the UI says "Fast 未生效". If it ever injects on yours, that means
your endpoint repeated a >=15% win at least twice.
```

## Notes

- 不要用 "revolutionary" / "blazing" / "10x"，那边会当场嘲讽。
- 不要写中转的真实 host，"my own OpenAI-compatible relay" 就够了。
- 正文里的仓库链接是唯一链接，标题里不要放链接（很多版块按规则会删）。
- 发帖时 Flair 选 **Discussion**（如果版块要求）。
- 第一小时内的评论尽量都回，Reddit 的排序算法看互动。
