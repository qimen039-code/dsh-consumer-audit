# 证据与边界

本文件是 `dsh-consumer-audit` 的交付证据链。它记录：内容从哪来、每条声明凭什么成立、什么会推翻它、没验证什么。

---

## 1. 内容来源：四段对话里用户对我的纠正

| # | 纠正 | 证据定位 | 落到产物的哪一处 |
|---|---|---|---|
| C1 | 声称"完成/已实现"必须带证据链，否则只能写"未验证"；**外壳存在 ≠ 效果已验证** | `session-afb2abc3` user seq=1484 | `SKILL.md` §2 五栏证据链格式、§4 禁止清单 |
| C2 | **服务必须有消费者**；注册了却无人调用 = 死代码 | `session-afb2abc3` user seq=1484 | 整个 `consumer_audit` 工具；`SKILL.md` §5 判据 |
| C3 | 材料出现在工具输出里 ≠ 形成了联想 | `session-afb2abc3` user seq=1484 | `SKILL.md` §8 反模式清单 |
| C4 | 更新时必须清理过期内容，不能只加不删 | `session-afb2abc3` user seq=257 | `SKILL.md` §6.3 |
| C5 | 不按层级判断，按证据与后果；不做二极管；**不自封授权，也不自封否决**；等价方案选更优而不是选被允许的 | `session-afb2abc3` user seq=2962 / 2985 | `SKILL.md` §4.4；本文件 §4 不把 app.asar 改动当禁地 |
| C6 | 看到良性可能性要先查证再汇报，不要先汇报已知 | `session-89ec113e` user seq=659 | `SKILL.md` §1 证伪条件；本文件 §5 |
| C7 | 区分「事实」与「仅推理得出、还不能当完全证据的结论」 | `session-89ec113e` user seq=1095 | `SKILL.md` §1、§2 归类表 |
| C8 | 纠偏机制维护成本过高 = 治标不治本 | `session-89ec113e` user seq=659 | 本文件 §4：工具只测量、不做语义裁决，避免维护一份判定规则 |
| C9 | 文件能做最小修改的不重写，可复用的不重写 | `session-047ef61a` user seq=1278 | 代码分层：纯判定（`audit.js`）与 I/O（`collect.js`）分离，可分别替换 |
| C10 | 审查已有插件是否**实际有效**，而不是我已经做过的伪实现 | `session-afb2abc3` user seq=1227 | 工具的首个真实 finding（见 §3） |

**我自己在本会话犯的错**（`session-bdca6d9e`，也进了 `SKILL.md` §8）：

| 错误 | 后果 |
|---|---|
| 把答案键 `cases.json` 写进被测语料目录 | `plumbus` 等"不存在"的词全部假命中，整轮负向对照作废 |
| 把语料里真实存在的 `quantum` / `price` 当"不存在的词" | 多词负向对照不成立 |
| 把 PowerShell 控制台解码问题当成产品缺陷 | 差点误报 |
| 查错字段名（`location`）就断言"没有坐标" | 假缺陷 |
| **把"关掉数据源"当成消融** | 见 §3.2，这条直接改掉了实现 |

---

## 2. 边界声明

本产物明确**不**声称以下任何一条：

1. **静态注册站点只证明"声明了"，不证明"能用"。** 扫描器匹配的是调用点，不是行为。
2. **调用计数只描述「被扫描的日志」。** 未扫描的 profile、日志窗口之前的调用，一律读成 0。本次扫描 15 个会话文件，这只是本机存在的那 15 个。
3. **第一方 `@deepseek-ai/*` 包不搜索。** 它们随 harness 发行（在 `app.asar` 内），报告记为 `first_party_shipped`，**不是**"缺失"。
4. **扫描是启发式的。** 目前的模式集：`tools.register` / `provide(` / `.section(` / `skills.register` / `commands.register` / `webServer.register` / `ctx.effect(`。用其他方式注册的包会被误报，报告里写明了模式集。
5. **包裹既有服务方法的行不做判定。** `@mj/dsh-image-admit` 就是这种：它改的是 `llm.resolveModelInfo`，不注册任何新能力，调用计数判断不了它。报告记 `intercepts_host_behaviour`，**不是**缺陷。
6. **报告不含语义判断。** 一条 `tool_never_invoked` 不等于插件写得差。

---

## 3. 消融实验

### 3.1 设计

`ablation()` 跑两轮：开消费者计数 / 关消费者计数。**关掉时把结果记为「未评估」，不是记为 0。**

### 3.2 第一版消融是坏的（实测发现）

第一版实现里，关掉计数 = 把所有 invocation 置空 → 每个工具都读成 0 → 全部变成 `never_invoked`。输出是：

```json
"without_consumers": {"row_without_capability":1,"tool_never_invoked":3,"package_unresolved":4,"skill_never_loaded":4},
"findings_only_with_consumer_evidence": [],
"verdict": "consumer evidence changed nothing: the report is a plain inventory"
```

看起来差异巨大，**实际只是把输入置空了**，而且判词还反了。这正是 `SKILL.md` §3 禁止的那件事。

修正后：

```json
"with_consumers": {"tool_never_invoked": 1},
"without_consumers": {},
"unassessed_without_consumers": 7,
"findings_only_with_consumer_evidence": ["tool_never_invoked|continuity_recall (from @mj/dsh-continuity)"],
"verdict": "consumer evidence narrowed 7 declared-but-unmeasured capabilities into 1 finding(s)"
```

### 3.3 消融的证伪条件

> 如果一条被归因于"消费者证据"的 finding，实际上并不由扫描日志里的调用计数支撑，本机制不成立。

### 3.4 消融**不能**证明什么

- 不能证明"没有消费者"就等于"没用"。可能有消费者在没被扫描的 profile 里。
- 不能证明扫描器没有漏（见 §2.4）。

---

## 4. 第一性原理自审

**问：这个插件的最小可观察效果是什么？**
答：一条 `tool_never_invoked`，把"注册了"和"被用过"这两件事分开。

**问：谁消费它？**
答：调用模型（通过 `consumer_audit` 工具）与读报告的人。消费者知道它生效了，是因为报告给出具体对象名与计数，而计数**能被独立重数推翻**。

**问：它依赖哪些假设？**
| 假设 | 不成立会怎样 |
|---|---|
| 会话日志里 `tool/call` 记录的 `data.name` 就是工具名 | 计数全错。**已用对照组验证**：`continuity_state` 66、`set_retention_tier` 6 |
| 包管理器在 profile 的 `node_modules` 下 | 第一方包会误报；已按第一方规则排除 |
| 注册发生在被扫描的源码里 | 误报；已声明模式集与边界 |

**问：有没有更便宜的等价方案？**
有，而且已在用：**不建索引、不常驻服务、不做语义裁决**。工具每次现读现算（本机 1.3–1.5 秒）。引入缓存或 LLM 裁决会同时增加维护成本与"自污染"风险——用户明确说过纠偏机制维护成本过高就是治标不治本（C8）。

**问：app.asar 能不能改？**
能。用户已在 C5 明确：部署本体是可权衡的约定，不是禁地。本插件选择**不改** app.asar，理由不是"被禁止"，而是**它更优**：改 asar 会被升级覆盖、且 asar integrity 会自相矛盾；做成普通插件持久生效。

---

## 5. 与已有市场条目的重复检查

市场评审第 4 条要求确认是否已被覆盖。逐条对照已收录条目：

| 已有条目 | 它做什么 | 与本插件的关系 |
|---|---|---|
| `Jonah-Wu23/dsh-gungnir` | 用命令退出码与产物校验**目标完成**，`/ultragoal` 锁目标 | 它判"某个目标完成没有"；本插件判"某个能力有没有消费者"。**不同问题** |
| `bycall/dsh-answer-reviewer` | 用第二个 LLM 给每轮答复打 1–100 分 | 引入旁路 LLM；本插件零 LLM 调用 |
| `CAI-MH/dsh-quality-review` | 独立评审模型审查每轮输出 | 同上 |
| `FuRongJun-1999/dsh-memory` | 元认知与持续学习架构 | 记忆/学习，不是组合审计 |
| `kenz1117/dsh-engram` | 跨会话长期记忆 | 同上 |

**结论：未被覆盖。** 差别在两处：判据不同（消费者 vs 完成），且本插件**不引入任何模型调用**——报告里的每个数字都能被独立重数推翻。

---

## 6. 冗余与伪实现清理

本次对**自己的产物**做的清理：

| 动作 | 对象 | 依据 |
|---|---|---|
| 删 | 第一版消融实现 | §3.2，它把输入弄坏并给出反向判词 |
| 改 | `row_without_capability` 的判定条件 | `image-admit` 是假阳性；补 `ctx.effect` 模式后改记为 `intercepts_host_behaviour` |
| 改 | `package_unresolved` 的适用范围 | 第一方包在 asar 内，报"缺失"是假警报 |
| 分 | `audit.js`（纯判定）/ `collect.js`（I/O） | C9 最小改动：判定可被独立替换与复用，不必重写采集 |
| **改** | **导出形状：`export default function apply` → `export default { name, apply }`** | 见 §6.1，这是最严重的一条 |
| **改** | **验证器断言的契约** | 见 §6.1，上一版验证是自证的 |

### 6.1 最严重的一条：我的验证是自证的

第一版 `lib/index.js` 导出的是**函数**（`export default function apply(ctx, config)`），而本机能加载的两个插件（`@mj/dsh-continuity`、`@mj/dsh-image-admit`）导出的都是**对象**：

```js
export default { name: NAME, inject: [...], apply(ctx) { ... } };
```

按第一版形状，loader 装不上这个插件。而 `verify-plugin.mjs` 当时**报了 15/15 通过**——因为那个假 ctx 的契约是**我自己写的**，我拿假设去验假设。检查全绿，产物装不上，这正是"伪实现"的标准长相。

修法两步，缺一不可：
1. 改插件为真实形状；
2. **改验证器去断言真实契约**（`default` 是对象、有 `name`、有 `apply`），并从本机两个可加载插件里读出该契约，而不是自己发明。

修后 19/19。**这条留在这里，因为它比任何正例都更能说明 §2 的判据为什么必须落在产物上。**

### 6.2 没有做的清理

本次**没有**删除用户既有 profile 的任何行、插件或 skill。工具只读，不写任何东西。

---

## 7. 交付证据链（五栏格式）

```
判据：  ① 市场 contributing.md 的机械要求全部可本地核验；
        ② npm pack 出的 tarball 装进隔离前缀后，从装好的副本再跑一遍插件检查必须全过；
        ③ 插件导出形状必须与"本机能加载的插件"一致，而不是与本验证器一致；
        ④ tool_never_invoked 的 finding 必须能被独立重数推翻。
执行：  node tools/verify-market-manifest.mjs
        node tools/verify-plugin.mjs                                  (源码树)
        npm pack --pack-destination .install-check
        npm install --prefix .install-check --no-save --ignore-scripts <tgz>
        node tools/verify-plugin.mjs .install-check/node_modules/dsh-consumer-audit
        node tools/recount-name.mjs continuity_recall | continuity_state | set_retention_tier
观测：  ① 22/22 通过
        ② tarball 9 个文件；隔离安装 added 4 packages；装好的副本 19/19 通过
        ③ 契约由 @mj/dsh-continuity(export default { name, inject, apply }) 与
           @mj/dsh-image-admit 读出；修形状后 19/19（修之前是 15/15 的假通过，见 §6.1）
        ④ continuity_recall: tool/call 含字符串 14 条，精确调用名 0 条
           continuity_state 66 条；set_retention_tier 6 条
归类：  applied_verified（工具逻辑、安装性、市场清单要求、导出形状）
        consumer_verification_gap（**未验证**：装好后由 DSH loader 真实加载并出现在模型工具表里）
边界：  没有在真实 profile 上执行 dsh plugin add（会改动用户活动插件树，AGENTS.md §2 记录过
        未声明的本地包会让整棵树加载失败）；没有启动 harness 端到端验证；
        扫描只覆盖本机存在的 15 个会话文件。
```

`stopped` 与 `applied` 不混用：**loader 加载这一环是 `stopped`，不是成功。**

原始日志见 `EVIDENCE-run.log`。
