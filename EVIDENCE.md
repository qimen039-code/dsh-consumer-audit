# 证据与边界

本文件是 `dsh-consumer-audit` 的交付证据链。它记录：内容从哪来、每条声明凭什么成立、什么会推翻它、没验证什么。

---

## 1. 内容来源：四段对话里用户对我的纠正

| # | 纠正 | 证据定位 | 落到产物的哪一处 |
|---|---|---|---|
| C1 | 声称"完成/已实现"必须带证据链，否则只能写"未验证"；**外壳存在 ≠ 效果已验证** | `S1` user seq=1484 | `SKILL.md` §2 五栏证据链格式、§4 禁止清单 |
| C2 | **服务必须有消费者**；注册了却无人调用 = 死代码 | `S1` user seq=1484 | 整个 `consumer_audit` 工具；`SKILL.md` §5 判据 |
| C3 | 材料出现在工具输出里 ≠ 形成了联想 | `S1` user seq=1484 | `SKILL.md` §8 反模式清单 |
| C4 | 更新时必须清理过期内容，不能只加不删 | `S1` user seq=257 | `SKILL.md` §6.3 |
| C5 | 不按层级判断，按证据与后果；不做二极管；**不自封授权，也不自封否决**；等价方案选更优而不是选被允许的 | `S1` user seq=2962 / 2985 | `SKILL.md` §4.4；本文件 §4 不把 app.asar 改动当禁地 |
| C6 | 看到良性可能性要先查证再汇报，不要先汇报已知 | `S2` user seq=659 | `SKILL.md` §1 证伪条件；本文件 §5 |
| C7 | 区分「事实」与「仅推理得出、还不能当完全证据的结论」 | `S2` user seq=1095 | `SKILL.md` §1、§2 归类表 |
| C8 | 纠偏机制维护成本过高 = 治标不治本 | `S2` user seq=659 | 本文件 §4：工具只测量、不做语义裁决，避免维护一份判定规则 |
| C9 | 文件能做最小修改的不重写，可复用的不重写 | `S3` user seq=1278 | 代码分层：纯判定（`audit.js`）与 I/O（`collect.js`）分离，可分别替换 |
| C10 | 审查已有插件是否**实际有效**，而不是我已经做过的伪实现 | `S1` user seq=1227 | 工具的首个真实 finding（见 §3） |

S1 到 S4 是本机四段会话的本地代号。对应关系不公开，因为会话 id 属于本机信息。

**我自己在本会话犯的错**（S4，也进了 `SKILL.md` §8）：

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
5. **包裹既有服务方法的行不做判定。** `另一个本机私有插件` 就是这种：它改的是 `llm.resolveModelInfo`，不注册任何新能力，调用计数判断不了它。报告记 `intercepts_host_behaviour`，**不是**缺陷。
6. **报告会写出它搜索了哪些根。** `generated_from.preset_roots_searched` 逐条给出 `origin / dir / searched`。没被解析到的根会让它的 skill 从报告里消失，所以那一行必须显示 `searched:false`，不能安静地少几条。这条是实测发现缺陷后补的，见 §6.3。
7. **计数会随会话增长漂移。** 同一台机器同一个工具，`continuity_state` 从 66 涨到 68，只是因为本会话又调用了两次。数字只对"运行那一刻的日志集合"成立。

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
"findings_only_with_consumer_evidence": ["tool_never_invoked|continuity_recall (from 一个本机私有插件)"],
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
有，而且已在用：**不建索引、不常驻服务、不做语义裁决**。工具每次现读现算（本机 1.3–1.5 秒）。引入缓存或 LLM 裁决会同时增加维护成本与"自污染"风险，用户明确说过纠偏机制维护成本过高就是治标不治本（C8）。

**问：app.asar 能不能改？**
能。用户已在 C5 明确：部署本体是可权衡的约定，不是禁地。本插件选择**不改** app.asar，理由是它更优：改 asar 会被升级覆盖，且 asar integrity 会自相矛盾；做成普通插件则持久生效。

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

**结论：未被覆盖。** 差别在两处：判据不同（消费者 vs 完成），且本插件**不引入任何模型调用**，报告里的每个数字都能被独立重数推翻。

### 5.1 真正的消费者：市场自己的解析器（本轮补的）

上一轮我只把 entry 对着**我自己读的 contributing.md** 校了一遍。那正是 §6.1 那个自证陷阱的同一种形态，**我拿自己的理解去验自己的产物**。

这一轮换成真消费者。市场源码 `src/registry.ts` 自己写明了做法：

> "the layer-3 e2e points it at a local fixture catalog so the install route can be driven end to end **without publishing anything**"

`DSHM_REGISTRY_URL`（`lib/regions.js:178`）就是这个口子。于是：本地起一个 HTTP fixture → 指向它 → 调市场自己的 `lib/registry.js` 的 `loadRegistry()` 与 `lib/sources.js` 的 `installTargetFor()`。

**发现：消费格式 ≠ 投稿格式。**

| | 字段 |
|---|---|
| 投稿（`data/plugins/*.yml`） | `url` `name` `category` `description{en,zh}` `tarball?` |
| 消费（`plugins.json` 的 `RegistryPlugin`） | 上面全部 **+ `owner` `page` `install` `added`**，并包在 `{name,url,source,updated,count,categories,plugins}` 里 |

那些多出来的字段由站点生成器补。**我的 YAML 不需要改**，但如果我只读文档不读消费者，就没法知道 `install` 是必填、`page` 存在、`category` 在消费端会被规范化成数组。

**权威形状取自线上目录**（`tools/fetch-live-catalog.mjs`）：3,561 条、2,903,494 字节，字段实测为
`name, owner, url, page, category, description{n,zh}, npm?, version?, stars?, downloads?, install, added`。
分布：`install` 缺失 0 条、`owner` 缺失 0 条；**无 npm 1,900 条；无 tarball 3,344 条（94%）**。
⇒ 我这种"无 npm、无 tarball、走 GitHub 源"的形态是**主流**，不是边角。

**结果：13/13。** 其中三条是负向对照，证明这个测试会失败：

```
control: 非 GitHub 的 url           -> installTargetFor 返回 null
control: category 为空              -> loadRegistry 抛出 "carries no usable category"
control: plugins 为空数组            -> loadRegistry 抛出 "came back empty"
```

正例：`installTargetFor(entry)` → `github:qimen039-code/dsh-consumer-audit`。

**边界**：本脚本对"YAML → plugins.json"的映射（`owner/page/install/added`）是**我的重建**，那个生成器不在数据仓库里，映射是从线上目录的实际形状反推的。被验证的**消费者一侧是原样、未改动的**。

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
| **改** | **`package.json` 的 `repository.url`** | 见 §6.6，占位符写错了账号 |
| **清** | README 与 SKILL.md 的 AI 写作特征 | 见 §6.7 |

### 6.6 `repository.url` 里写的是占位符

建仓并核验远端时发现：`package.json` 的 `repository.url` 里写的是占位账号，实际账号是 `qimen039-code`。这是我起初不知道账号时留的占位符，一直没回头核对。

contributing.md 写明："The published package's `repository` field must point back at the repository listed here, or the two are not linked." 也就是说，如果这个字段错了，npm 包与列表条目不会关联。

已修，并在 `tools/verify-market-manifest.mjs` 里加了断言：`repository.url` 必须包含条目的 `owner/repo`。**并跑了负向对照**：把账号改回 `MJ`，检查降到 22/23 且 exit 1，确认这条断言会失败而不是恒真。

发现它的原因很直接：建完仓库以后没有只信 `gh` 的回显，而是把远端文件抓回来逐项核对。

### 6.7 AI 写作特征

用户要求去掉 AI 味。依据取自 Wikipedia:Signs of AI writing（CC BY-SA，**未**随 MIT 仓库提交，放在仓库外的 `dsh-consumer-audit-references/`），并落成一个可跑的检查 `tools/lint-prose.mjs`，覆盖十个特征：破折号滥用、反向对举（中英文各一条正则）、只列否定的排比、内联加粗小标题列表、强化程度词、总结与结论段、伪范围、弯引号。

结果：

| 文件 | 违规 | 加粗/百行 |
|---|---:|---:|
| `README.md` | 0 | 0 |
| `README.zh.md` | 0 | 0 |
| `skills/consumer-audit/SKILL.md` | 0 | 38.6 |
| `EVIDENCE.md` | 0 | 55.5 |

README 两个版本是重写的。SKILL.md 与本文是清掉破折号与反向对举。**加粗密度仍偏高**：SKILL.md 是给模型的纪律条文，加粗承担强调功能；本文是工作记录。这一项**没有降到 README 那种水平**，如实列出，不算完成。

### 6.1 最严重的一条：我的验证是自证的

第一版 `lib/index.js` 导出的是**函数**（`export default function apply(ctx, config)`），而本机能加载的两个插件（`一个本机私有插件`、`另一个本机私有插件`）导出的都是**对象**：

```js
export default { name: NAME, inject: [...], apply(ctx) { ... } };
```

按第一版形状，loader 装不上这个插件。而 `verify-plugin.mjs` 当时**报了 15/15 通过**，因为那个假 ctx 的契约是**我自己写的**，我拿假设去验假设。检查全绿，产物装不上，这正是"伪实现"的标准长相。

修法两步，缺一不可：
1. 改插件为真实形状；
2. **改验证器去断言真实契约**（`default` 是对象、有 `name`、有 `apply`），并从本机两个可加载插件里读出该契约，而不是自己发明。

修后 19/19。**这条留在这里，因为它比任何正例都更能说明 §2 的判据为什么必须落在产物上。**

### 6.3 我用一个不成立的理由删了证据（本轮）

我判定 `tools/audit-run-1.txt` 是**"修好之前那一轮、含坏掉的消融数字"**，据此删除。删除后核对，发现这个理由**是错的**：

```
audit-run-1.txt 里的 verdict: "consumer evidence narrowed 7 ... into 1 finding(s)"
那正是修好之后的措辞；坏掉那版说的是 "changed nothing"
```

它是一轮**有效**运行，与后来那次只差 `unassessed` 的 7 vs 5。**我当时恢复了它。**

后来它还是被移出了仓库，但理由完全不同，而且是可验证的：它逐行记录了运行时的绝对路径。见 §6.8。**同一个文件被删两次，第一次的理由是编的，第二次的理由有扫描器撑腰。** 这一条留着，因为两者的区别就是这个项目想守住的东西。

但这个错误操作顺带暴露了一个**真缺陷**：两次运行差 2，是因为 `lib/index.js` **从不给 `shippedPresetsDir` 设默认值**，只读 config。于是装好的插件在没有任何配置时会**静默漏掉随 harness 发行的 preset 里的全部 skill**（4 → 2），而报告里看不出少了什么。

修法两条：
1. `lib/index.js` 自己用 `createRequire` 去解析 `@deepseek-ai/dsh-agent-presets`，解析得到就用；
2. **无论成功与否，报告都写出搜索了哪些根**（`generated_from.preset_roots_searched`，逐条 `searched: true/false`），并加了一条验证：**shipped 根被标记为 searched，当且仅当确实提供了它**。

修后两个运行上下文一致（都是 7）。**这条的价值在于：差点被我用一个编造的理由"清理"掉的，正是能暴露这个静默缺陷的那个文件。**

### 6.4 一个被对照否掉的测试

我想用 `dsh --profile desktop --patch <overlay> --dump-config` 证明 loader 能解析我的包。先跑了对照：插一行**不可能解析**的包名，`--dump-config` **照样成功组合并原样输出**。

⇒ `--dump-config` **不校验解析**，只做组合。这个测试**证明不了任何事**，因此不作为证据。它顺带确认了一件小事：loader 会把绝对路径规范化为 `file:///C:/...`。

### 6.5 没有做的清理

本次**没有**删除用户既有 profile 的任何行、插件或 skill。工具只读，不写任何东西。

**特别地：`continuity_recall` 缺少消费者这条 finding，我没有据此删除或改动 `一个本机私有插件`。** 报告给出事实，是否删是你的决定。

---

## 7. 交付证据链（五栏格式）

```
判据：  ① 市场 contributing.md 的机械要求全部可本地核验；
        ①b 我的投稿 entry 必须能被**市场自己的**解析器与安装目标解析器消费，且控制组会失败；
        ② npm pack 出的 tarball 装进隔离前缀后，从装好的副本再跑一遍插件检查必须全过；
        ③ 插件导出形状必须与"本机能加载的插件"一致，而不是与本验证器一致；
        ④ 报告必须写出它搜索了哪些根；shipped 根被标记 searched 当且仅当确实提供了它；
        ⑤ tool_never_invoked 的 finding 必须能被独立重数推翻。
执行：  powershell -File tools\run-evidence.ps1        （一条命令重跑全部五节）
        node tools\verify-market-manifest.mjs
        node tools\verify-market-consumer.mjs --market <dshmarket>   （本地 fixture + DSHM_REGISTRY_URL）
        node tools\fetch-live-catalog.mjs                            （取权威生成形状与分布）
        node tools\verify-plugin.mjs                    （默认根 / 显式根 / 装好的副本，三种上下文）
        npm pack --pack-destination .install-check
        npm install --prefix .install-check --no-save --ignore-scripts <tgz>
        node tools\recount-name.mjs continuity_recall | continuity_state | set_retention_tier
观测：  ①  22/22
        ①b 13/13；installTargetFor -> github:qimen039-code/dsh-consumer-audit；
           三条负向对照分别命中 null / "no usable category" / "came back empty"
        ②  tarball 9 个文件；隔离安装 added 4 packages；装好的副本 22/22
        ③  契约由 一个本机私有插件(export default { name, inject, apply }) 与
           另一个本机私有插件 读出；修形状前是 15/15 的假通过（见 §6.1）
        ④  默认根：shipped preset 行 searched=false；显式根：searched=true 且 skill 数 2 → 4
        ⑤  continuity_recall: tool/call 含字符串 14 条，精确调用名 0 条
           continuity_state 70 条（66 → 68 → 70，随本会话增长）；set_retention_tier 6 条
        一节不通过脚本即 exit 1：`all steps passed` / `FAILED: ...`
归类：  applied_verified（工具逻辑、安装性、市场清单要求、**市场消费者解析**、导出形状、根搜索可见性）
        stopped（**未验证**：装好后由 DSH loader 真实启动加载；以及站点生成器本身）
边界：  没有在真实 profile 上执行 dsh plugin add（会改动用户活动插件树，AGENTS.md §2 记录过
        未声明的本地包会让整棵树加载失败）；没有启动 harness 端到端验证；
        **没有向 awesome-dsh-plugin 提 PR**，所以"已进入市场"仍未发生；
        扫描只覆盖本机存在的 15 个会话文件；计数随会话增长漂移；
        本机市场配置了一个 HTTP 代理，地址不记录。本地 fixture 抓取未受影响，正例通过。
```

`stopped` 与 `applied` 不混用：**loader 启动加载这一环是 `stopped`，不是成功。**

本节所有数字的原始日志由 `tools/run-evidence.ps1` 生成，落在本机 `EVIDENCE-run.log`，**不入库**。理由见 §6.8。

### 6.8 本机信息泄漏排查（本轮）

用户要求遍历所有文件，确认没有把本机的东西写进公开仓库。为此写了 `tools/scan-secrets.mjs`，遍历 `git ls-files` 的每一个文件，按九类模式扫：绝对 Windows 路径、绝对 POSIX 路径、本机会话 id、回环地址、凭据形状、`.dsh` 目录布局、私有包作用域、第三方本机工具路径、个人文档路径。

**第一次跑出 109 处命中，但里面有假阳性**：盘符那条正则把转义 URL 里的斜杠序列读成了盘符。收紧成「盘符前不得是字母数字」后降到 89 处。**先修扫描器再清内容**，否则会去"修"根本不是问题的东西。

补一条：修好之后这次扫描**逮到了本文自己**。我把那条正则的形态照抄进了这段说明，于是说明本身长得像一条盘符路径。这里没有去放宽扫描器，改的是这段正文。反引号里的绝对路径也该被抓到，这是扫描器该有的行为。

处理结果：

| 对象 | 处理 | 理由 |
|---|---|---|
| `EVIDENCE-run.log`、`tools/audit-run-*.txt`、`tools/*.json` | 移出仓库并加进 `.gitignore` | 生成的运行产物，逐行含绝对路径；由 `run-evidence.ps1` 可重跑 |
| `EVIDENCE.md` 里的私有包作用域 | 改成「一个本机私有插件」 | 私有 npm 作用域属于本机信息 |
| `EVIDENCE.md` 里的代理地址 | 删掉具体端口 | 本机服务地址 |
| `tools/overlay-path.yml` | 删除 | 一次性探针，含绝对路径；结论在 §6.4 已记 |
| `recount-name.mjs` / `run-audit.mjs` / `verify-market-consumer.mjs` | 硬编码路径改成从 `DSH_HOME` 或 `homedir()` 推导 | 脚本本身不该绑定某台机器 |
| `run-evidence.ps1` 的 shipped presets 路径 | 改成由 `SHIPPED_PRESETS_DIR` 环境变量提供，未提供则该节记 SKIPPED | 该路径随安装位置变化，不该写死 |

`tools/scan-secrets.mjs` 已接进 `tools/run-evidence.ps1` 的第六节。**仓库当前状态：24 个受跟踪文件，0 处命中。** 这条是闸门，不是一次性检查：再写入本机路径，证据链会失败。

**保留未改的**：`continuity_recall` 这个工具名。它是重数验证的对象，匿掉就没法复核。私有包作用域已去掉，只留工具名。
