# 🚀 DSH Turbo Mode

> Codex 风格 Fast Mode for DeepSeek Harness —— 用**服务端优先通道**换速度，不降推理强度、不缩输出、不换模型。

[English](./README.en.md) | [实测报告](./docs/BENCHMARKS.md)

---

## ⚠️ 先说实话（重要）

这个插件**实现了**三件事：

1. 会话级的 **标准 / 极速** 切换；
2. 在**服务商真的提供优先档位**的端点上，把官方参数（如 `service_tier: "priority"`）注入真实请求；
3. 用真实请求做 A/B，**测出到底有没有变快**，并把结果如实显示在界面上。

它**不能**让一个没有优先通道的服务商凭空变快。作者在本机实测：

| 端点 | 模型 | 结果 |
| --- | --- | --- |
| 某企业内部 OpenAI 兼容中转（host 隐去） | `DeepSeek-V4.1-Flash-1017` | 参数被接受，但**没有可复现的加速**（4 轮 3 样本实测：+18.5% / +1.3% / +5.2% / +5.9%，中位数 +5.5%，噪声级别） |
| OpenAI（`api.openai.com`） | — | 官方文档明确 `service_tier=priority`，本机无密钥，**未实测** |
| DeepSeek 官方（`api.deepseek.com`） | — | 厂商无优先档位，插件不会发任何参数 |

所以：**这不是"一键变快"的魔法**。它是"如果服务商有快车道，就用它，并且诚实告诉你有没有用"。完整数据与测试方法见 [docs/BENCHMARKS.md](./docs/BENCHMARKS.md)。

---

## 它做什么

输入框右下角会出现一个开关：

```
Turbo   [ 标准 ] [ 极速 ]   首字 1204ms · 198 tok/s
```

- **标准**：请求原样发出，一个字节都不改。
- **极速**：仅在该端点**被确认支持**优先档位时，在请求 JSON 里增加一个字段。
  - 模型、推理强度、提示词、工具、温度、max tokens、验证步骤——全部不变。
  - 若端点不支持 / 未测量 / 测过但没效果，开关不生效，并在旁边写明原因（例：`该接入点没有官方优先档位，Fast 未生效`）。

### 它绝不做什么

- ❌ 不改系统提示词，不要求模型"少说点"（那是 prompt 侧提速，会降低质量）
- ❌ 不改 `reasoningEffort`，不缩短思考
- ❌ 不换更便宜的模型
- ❌ 不减少校验步骤
- ❌ 不伪造数据，不假装加速
- ❌ 不轮换密钥、不绕限流、不无限重试

---

## 安装

DSH 插件以 **bundle** 形式安装，需要 DSH ≥ 0.2.2。

1. 把本仓库目录放到任意位置（例如 `~/plugins/dsh-turbo-mode`）。
2. 在 DSH 的**插件面板**里安装该目录；host 侧对应动作是 `plugin_manager` 的 `install_bundle`（target = 该目录的绝对路径）。
   > 注意：包名是 **`dsh-turbo-mode`**。npm 上已有同名 `dsh-turbo`（另一个作者的项目），不要混装。
3. 装好后无需重启，输入框下方即出现 Turbo 开关（若未出现，在插件页把该 bundle 关掉再打开一次即可热重载）。

本机已验证的安装返回值：`application: "applied"`，`warnings: []`。

### 卸载

在插件面板停用或卸载该 bundle 即可：HTTP 路由、fetch 钩子、`turbo_mode` 工具、输入框开关会一起注销。唯一残留是 `<DSH_HOME>/dsh-turbo/` 下的两个 JSON（`state.json`、`capability.json`），可手删。

---

## 使用

- **点开关**：对**当前会话**生效；没选过会话时改的是默认档位（新会话继承）。
- **让 agent 改**：对 agent 说"把极速打开"，它会调用 `turbo_mode` 工具（`action: status | set | metrics | probe`）。
- **测一个中转**：`turbo_mode` 传 `action: "probe"`。插件会用同一个模型、同一个推理强度、同一句极小 prompt，**交错**各发 standard / fast 各 N 次，比较**首字延迟**；只有 fast 臂中位数快 ≥15% 且多数轮次更快，才把该端点标记为可用。
- **看数据**：`GET /turbo/state`、`GET /turbo/metrics`（仅回环地址可访问）。

### 支持的端点

| 端点 | 行为 |
| --- | --- |
| `api.openai.com`（含子域） | 注入 `service_tier: "priority"`（OpenAI 文档化能力） |
| `api.deepseek.com` | 明确不发（厂商无此档位） |
| 其它（含 OpenAI 兼容中转） | **默认不发**。先 probe，测出有效果才发；测出没效果则永不再发 |
| 你在配置里显式声明的端点 | 按你的声明执行（见下） |

未知端点绝不会被"猜着"注入参数——`unknown ≠ 大概率没问题`。

---

## 配置

插件自带 `cordis.patch.yml` 默认值；要覆盖时在 **profile** 的 `cordis.patch.yml` 里加同 id 的配置块：

```yaml
- id: turbo
  name: dsh-turbo-mode
  config:
    defaultSpeed: standard      # standard | fast，作为新会话默认
    holdMs: 15000               # 429 最长等待
    metricsCapacity: 200        # 内存里保留的样本数
    probeSamples: 3             # 每次 probe 的轮数（上限 5）
    dshHome: null               # 覆盖状态目录
    providers: {}               # 按端点的能力声明
```

中转方有书面说明、但不在内置表里时：

```yaml
    providers:
      'relay.example.com':
        support: documented
        param: { service_tier: priority }
        note: '中转文档说明支持优先处理'
```

反过来，若某端点会拒绝该参数，用 `support: unsupported` 直接禁掉注入。

---

## 它是怎么工作的

DSH 的 loop 在发出模型请求前会把 options **深度冻结**，且 LLM 调用配置没有"服务商私有参数"的入口。所以参数只能在**序列化后的 HTTP 层**加：

```
Harness loop → llm/stream（只测量，不改请求）
             → 适配器 → fetch hook
                          ├─ 该会话是标准档？→ 原样透传
                          ├─ 该会话是极速档 且 端点已确认支持？→ body 里加一个字段
                          └─ 否则 → 原样透传，并记录原因
```

- 会话归属用 `AsyncLocalStorage` 传递，**并发会话不会串档**。
- fetch 钩子每 2s 自检一次：如果别的集成（例如本机中转代理）把 `globalThis.fetch` 换掉了，钩子会重新包一层，避免"静默降级成标准档"——这是本项目踩过的真实坑。
- 其它集成替换 fetch 的场景已被单元测试覆盖。

### 指标含义

全部来自真实 HTTP 交换，没有估算：

- **TTFT / 首字**：从发请求到收到第一个 `text-delta`/`reasoning-delta` 的墙钟时间。
- **tok/s**：`usage.outputTokens ÷ 生成耗时`。
- **总耗时**：到流结束。
- **限流**：`status 429` 计数；**重试**：`retried` 标记；**held**：为遵守 `Retry-After` 而主动等待的次数。

---

## 稳定性

- **429**：读取 `Retry-After`（秒数或 HTTP 日期），下一次请求前等待该窗口（上限 `holdMs`，默认 15s）。**只延迟，不重试、不换密钥、不并发轰炸。**
- **不排队抢夺桌面控制**：本插件不注册任何桌面控制能力，也不会改变 DSH 原有的桌面操作安全机制。
- 所有计时/注入逻辑都在 `try/finally` 内释放上游流（`iterator.return()`），避免中断后 socket 悬挂。

---

## 开发与测试

零依赖、零构建，纯 ESM：

```bash
node --test "test/**/*.test.js"     # 41 个用例
```

覆盖：能力判定优先级、状态持久化与损坏恢复、指标聚合、fetch 钩子的注入/不注入/429 等待/自愈、probe 判定逻辑（含"参数根本没上线"的检测）。

## 局限（请照实理解）

- 客户端**无法**提升服务端生成速度；能加速的前提是服务商提供优先队列。
- 首字延迟受网络与代理影响很大，probe 的 15% 阈值是保守值，仍可能被噪声影响——这也是本插件把每次实测数字都写进 `capability.json` 的原因。
- 中转方若"接受但不实现" `service_tier`，本插件会如实判定为**无效**。

## 致谢

- [dsh-relay-fast](https://github.com/Rock-ql/dsh-relay-fast) —— 早期 `service_tier` 注入思路
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —— Cordis 插件框架

## 许可

MIT。见 [LICENSE](./LICENSE)。
