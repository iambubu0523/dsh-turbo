# X / Twitter 发布稿

> 一条主推 + 三条回复串。配图用 `docs/assets/social.jpg`（1280×640，正好是 X 的卡片比例）。

## 主推

```
I built a Fast Mode for DeepSeek Harness and then spent two weeks proving it doesn't work.

8 A/B probes against my own relay: median +5.5% — inside the noise.
Best single round: +23.6%. Reran it three times: -7.8%, -0.1%, +9.7%.

So the plugin now refuses to say "faster" until a gain repeats. 🧵
```

配图：`docs/assets/social.jpg`

## 回复 1/3 — 为什么只能这么干

```
The obvious speedups are all fake:
· tell the model to be brief → it just writes less
· drop reasoning effort → worse on hard tasks
· swap to a smaller model → not the same model

The only honest lever is asking the server for a higher queue priority:
service_tier: "priority".
```

## 回复 2/3 — 为什么难

```
DSH freezes the request object before plugins see it, so the field has to be injected after JSON
serialization — in a fetch hook. One field, nothing else.

Then: does it actually help? My first probe said +23.6% and I believed it. That was a mistake.
```

## 回复 3/3 — 三条规则

```
Now enforced in code:

1. one round never decides (samples < 3 → inconclusive)
2. verdicts aggregate history: 2 of the last 3 probes must be ≥15% faster
3. 400/422 = dead end, never retried

Default state against my relay: "accepted-no-effect" — parameter accepted, server ignored it.
```

## 回复 4/4 — 安装

```
Install (no npm account needed):

  github:iambubu0523/dsh-turbo

MIT, zero deps, zero build, 46 tests.

Run one probe against your endpoint and you'll know in 30s whether your provider actually gives
you a fast lane. Most don't.

https://github.com/iambubu0523/dsh-turbo
```

## 备注

- X 上不要一次发太长，主推控制在 4 行以内。
- 标签最多两个：`#LLM` `#DeepSeek`。堆标签会被判定为营销号。
- 如果发完 24 小时没人理，别删 —— X 的搜索会长期带来零散流量。
