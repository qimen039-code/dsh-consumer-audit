# dsh-consumer-audit

审计一个 DSH profile 里**没有消费者的能力**，并固定「完成声明」的证据链格式。

两半，一个判据：

- **`consumer_audit`（工具）**——测量。读活动 profile 里已声明的组成行，扫描每个已安装包的注册点，统计每个已注册工具与 skill 在本机会话日志里出现的次数，报告从未被观察到消费者的那些。也可按请求跑自身消融。
- **`consumer-audit`（skill）**——推理。固定"完成"的声明格式（边界声明、证据链、缺口归类）、消融纪律、第一性原理自审，以及怎么读那份报告。

工具不做质量判断。一条 `tool_never_invoked` 不表示插件写得差，只表示这条能力目前没有可观察的消费者。

## 安装

```sh
dsh plugin --profile <profile> add dsh-consumer-audit
```

需要 Node 22.15+（会话日志是多帧 zstd）。

## 报告里有哪几类

| 项 | 含义 |
|---|---|
| `tool_never_invoked` | 注册了，但在被扫描的日志里 0 次调用 |
| `skill_never_loaded` | `SKILL.md` 在盘上，没有任何会话加载过 |
| `prompt_only_capability` | 只注册提示词——是说明书，不是机制 |
| `row_without_capability` | 行挂上了、包也在，但没有任何注册或 effect 站点 |
| `duplicate_prompt_section` | 两个包注册同名提示词段 |
| `package_unresolved` | 非第一方行，但包解析不到 |

**记为 notes、刻意不算 finding** 的两类：

- `first_party_shipped` —— `@deepseek-ai/*` 随 harness 发行，不在 profile 里。
- `intercepts_host_behaviour` —— 包裹既有服务方法、不注册新能力。调用计数判断不了它，所以报告如实说明，而不是把这一行说成空的。

每条 finding 都带证据定位、按 ACCF effectiveness-gap 分类法给出的归类，以及**什么观测会推翻它**。

## 边界

- 静态注册站点只证明能力**被声明**，不证明它能用。
- 调用计数只描述**被扫描的那些日志**。未扫描的 profile、日志窗口之前的调用，都会读成未使用。
- 第一方包不搜索，记为 shipped，不报缺失。
- 扫描是启发式的。用本扫描不认识的调用点注册的包会被误报，报告里写明了它匹配哪些模式。
- 报告不含语义判断。

## 消融

```js
import { collect } from "dsh-consumer-audit/collect";
import { ablation } from "dsh-consumer-audit/audit";

const input = collect({ dshHome, profileDir });
console.log(ablation(input));
```

关掉消费者计数时，工具把那些能力记为**未评估**，而不是记为 0。把输入置空的那种"消融"看起来差异巨大，实际什么也没证明。

## 已验证

| 检查 | 结果 |
|---|---|
| `npm pack` → 装进隔离前缀 → 从装好的副本再跑全部检查 | 17/17 通过 |
| 报告 `continuity_recall` 从未被调用 | 独立重数同一批 15 个日志：14 条 `tool/call` 记录含该字符串，**0** 条以它为调用名；对照组 `continuity_state` 66 次、`set_retention_tier` 6 次 |

未验证：安装后由 DSH loader 真实加载。包是用导出的 `apply()` 对记录型上下文跑通的，不是启动一个 harness 跑通的。

## 许可

MIT
