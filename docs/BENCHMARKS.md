# 实测报告：Fast 到底有没有用？

本文件只放**真实测到的数字**。没有测过的，明确写"未实测"。

## 测试环境

| 项 | 值 |
| --- | --- |
| DSH | 0.2.2-rc.3（Electron 桌面版） |
| 系统 | Windows（本机） |
| Node | v24.21.0（DSH 内置运行时） |
| 模型 | `DeepSeek-V4.1-Flash-1017` |
| Provider | `relay`（企业内部 OpenAI 兼容中转，host 隐去） |
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

## 结果：企业内部中转

`host: relay.example.com`，`model: DeepSeek-V4.1-Flash-1017`。下表全部为**参数确认已上线**的轮次。

| # | 轮数 | standard 中位首字 | fast 中位首字 | 差值 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1187 ms | 1117 ms | **+5.9%** | accepted-no-effect |
| 2 | 3 | 1427 ms | 1163 ms | **+18.5%** | accepted-faster |
| 3 | 3 | 1241 ms | 1225 ms | **+1.3%** | accepted-no-effect |
| 4 | 3 | 1303 ms | 1236 ms | **+5.2%** | accepted-no-effect |

- 4 次测量的差值中位数：**+5.5%**
- 唯一一次越过 15% 阈值的 +18.5%，**无法复现**（后续两次分别只有 1.3% 和 5.2%）
- 结论：**该中转接受该参数，但没有可复现的服务端加速。** 写入 `capability.json` 的判定为 `accepted-no-effect`，插件在此端点**不会**再注入参数，界面显示"Fast 未生效"。

> 早期还有 0.19%、3.7%、9.3%、14.3% 等几轮，同样在噪声区间；当时 hook 曾被覆盖导致参数未上线，这些数字不作为证据，仅作记录。

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
2. 在本机唯一可用的中转上，`service_tier: "priority"` **被接受但无效**，差值在噪声级别。
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
