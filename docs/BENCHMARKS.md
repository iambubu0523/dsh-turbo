# 实测报告：Fast 到底有没有用？

本文件只放**真实测到的数字**。没有测过的，明确写"未实测"。

## 测试环境

| 项 | 值 |
| --- | --- |
| DSH | 0.2.2-rc.3（Electron 桌面版） |
| 系统 | Windows（本机） |
| Node | v24.21.0（DSH 内置运行时） |
| 模型 | `DeepSeek-V4.1-Flash-1017` / `DeepSeek-V4-Pro` |
| Provider | `relay`（作者自己的 OpenAI 兼容中转，host 隐去） |
| 实际链路 | 本机 HTTP 代理转发：`127.0.0.1:<port>` → 上游 `https://relay.example.com/v1/chat/completions` |
| 推理强度 | 未改动（沿用会话默认） |

## 测试方法

插件内置 probe：`POST /turbo/probe {"samples": N}`。

- 同一模型、同一 provider、同一推理强度、同一句 prompt：`Reply with the single word: ok`
- `maxTokens: 32`（只测首字，不测吞吐，成本极低）
- **交错**执行：每轮先发 standard（不注入），再发 fast（注入 `service_tier: "priority"`），避免"谁后跑谁吃亏"
- 指标：**首字延迟（TTFT）**，从调用 `llm.stream` 到收到第一个 `text-delta` / `reasoning-delta`
- 判定：fast 中位数快 ≥ **15%** 且多数轮次更快 → `accepted-faster`；否则 `accepted-no-effect`
- 每次调用都校验参数是否真的上了线（`paramSent`），避免"测了个空"——本项目早期就踩过这个坑（hook 被别的集成覆盖，参数根本没发出去，却得出"无效"结论）

## 结果：作者自己的中转

`host: relay.example.com`，`model: DeepSeek-V4.1-Flash-1017`。下表全部为**参数确认已上线**的轮次。

| # | 轮数 | standard 中位首字 | fast 中位首字 | 差值 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1187 ms | 1117 ms | **+5.9%** | accepted-no-effect |
| 2 | 3 | 1427 ms | 1163 ms | **+18.5%** | accepted-faster |
| 3 | 3 | 1241 ms | 1225 ms | **+1.3%** | accepted-no-effect |
| 4 | 3 | 1303 ms | 1236 ms | **+5.2%** | accepted-no-effect |
| 5 | 1 | 1453 ms | 1110 ms | **+23.6%** | accepted-faster（单轮，噪声） |
| 6 | 3 | 1110 ms | 1197 ms | **−7.8%** | accepted-no-effect |
| 7 | 3 | 1149 ms | 1150 ms | **−0.1%** | accepted-no-effect |
| 8 | 3 | 1382 ms | 1247 ms | **+9.7%** | accepted-no-effect |

- 8 次测量的差值中位数：**+5.5%**
- 两次越过 15% 阈值的（+18.5%、+23.6%）**都无法复现**：前者之后是 1.3%、5.2%，后者来自一次单轮探测，随后三轮是 −7.8%、−0.1%、+9.7%
- 结论：**该中转接受该参数，但没有可复现的服务端加速。** 写入 `capability.json` 的判定为 `accepted-no-effect`，插件在此端点**不会**再注入参数，界面显示"Fast 未生效"。

> 早期还有 0.19%、3.7%、9.3%、14.3% 等几轮，同样在噪声区间；当时 hook 曾被覆盖导致参数未上线，这些数字不作为证据，仅作记录。

## 为什么单次探测不足以判定

第 5 行那次 +23.6% 是**单轮探测**的结果：同一模型、同一端点、同一请求，只有一次交错对比。它在当时把端点判定成了"已验证"，插件开始注入——但后续三轮全部为负或微正，说明那次领先只是网络抖动。

因此代码里加了两道约束（`lib/probe.js`、`lib/capability.js`）：

1. **少于 3 轮不给结论**：`samples < 3` 一律返回 `inconclusive`，并提示"a verdict needs at least 3"；
2. **按历史聚合，而不是看最后一次**：每个端点+模型保留最近 5 次探测，取最近 3 次有效结果，**至少 2 次**显示更快才允许判为 `verified`；全都不快判 `accepted-no-effect`；一次快一次不快判 `unknown`（Fast 保持关闭，等它复现）。

第 6–8 行就是这套规则的实测：三次 3 轮探测分别 −7.8%、−0.1%、+9.7%，聚合结论 `accepted-no-effect`，`effective: false`。

> 老版本写入的、没有 `support` 字段的判定不再被信任（界面提示重新探测）；"服务商拒绝该参数"（HTTP 400/422）属于硬信号，不需要统计，仍然直接判 `unsupported`。

## 结果：真实对话请求（standard）

用于给出"平时的基线"，不是 A/B：

| 输出 tokens | 首字延迟 | 总耗时 | 吞吐 |
| --- | --- | --- | --- |
| 213 | 2805 ms | 4686 ms | 183 tok/s |
| 326 | 2909 ms | 4.9 s | 198 tok/s |
| 437 | 3770 ms | 5.0 s | 199 tok/s |

首字延迟在 2.8–3.8s，其中相当一部分是上游排队与代理往返——这正是"优先档位"理论上能改善的部分，也是本插件只测首字的原因。吞吐（tok/s）在 183–199 之间稳定，未观察到与档位相关的差异。

## 未实测的部分

| 端点 | 说明 |
| --- | --- |
| `api.openai.com` | OpenAI 文档化 `service_tier=priority`，本机 profile 无 OpenAI 密钥，**没有实测**，因此不宣称有效 |
| `api.deepseek.com` | 厂商无优先档位，插件不注入 |
| 其它中转 | 需要各自 probe；本项目不做"通用加速"承诺 |

## 结论（照实说）

1. **客户端插件无法凭空提升服务端生成速度。** 唯一能真正加速的是服务商提供的优先队列。
2. 在本机唯一可用的中转上，**两个模型（V4.1-Flash、V4-Pro）都没能复现稳定加速**。V4.1-Flash：8 次 probing 中位 +5.5%，噪声级。V4-Pro：3 次 3 轮 probe 结果互相矛盾（+15.4% / −236.9% / +9.3%），延迟抖动巨大，聚合规则拒绝判定。
3. 所以本项目的定位是：**能力判定 + 真实切换 + 诚实测量**，而不是"一键变快"。谁家真开了快车道，probe 会测出来并把开关点亮。
4. 若某天你在 OpenAI（或声明支持优先处理的中转）上跑 probe 得到 ≥15% 的稳定领先，那才是"Fast 真的生效"。

## 复现方式

```bash
# 需要 DSH 正在运行（回环地址才能访问）
curl -s -X POST http://127.0.0.1:<GUI_PORT>/turbo/probe \
     -H 'content-type: application/json' -d '{"samples":3}'

# 看当前档位、端点判定、注入统计
curl -s http://127.0.0.1:<GUI_PORT>/turbo/state
```

`<GUI_PORT>` 取 DSH 窗口地址栏端口（每次启动不同）。返回里的 `transport.injected` 是"真正注入过几次"，`capability.support` 是判定结果，`effective` 是"Fast 是否真的生效"——以它为准，别信界面文案。
