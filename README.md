# dsh-consumer-audit

[English](README.en.md) | 中文

一个 DeepSeek Harness 插件：报告 profile 里哪些能力没有可观察的消费者，并附一份固定「完成声明」写法的 skill。

## 它做什么

插件注册一个模型工具和一个 skill。

`consumer_audit` 读取活动 profile 的组合行，把每一行解析到它安装的包，扫描该包的注册站点，再统计每个已注册工具与 skill 在 `DSH_HOME` 下会话日志里出现的次数，报告其中没有观察到消费者的那些。

skill 名为 `consumer-audit`，给出「完成」的写法规则：边界声明、五栏证据链、缺口归类，以及什么观测会推翻这条声明。

工具不给插件打分。一条 finding 说明某项能力没有可观察的消费者，不说明背后的插件不好。

## 安装

```sh
dsh plugin --profile <profile> add github:qimen039-code/dsh-consumer-audit
```

需要 Node 22.15 或更新版本，因为会话日志是多帧 zstd。

## 怎么读报告

| 字段 | 含义 |
| --- | --- |
| `tool_never_invoked` | 工具已注册，被扫描的日志里没有对它的调用 |
| `skill_never_loaded` | 盘上有 `SKILL.md`，被扫描的会话没有加载过 |
| `prompt_only_capability` | 这个包只注册提示词 |
| `row_without_capability` | 行已挂载、包也解析到了，但它什么都没注册 |
| `duplicate_prompt_section` | 两个包注册了同名的提示词段 |
| `package_unresolved` | 这一行的包既不在 profile 里，也不属于随 harness 发行的那批 |

有两类结果记为 notes 而不是 finding，因为调用计数判断不了它们。包名以 `@deepseek-ai/` 开头的行随 harness 发行，搜索为空说明不了任何事。包裹既有服务方法的包不注册新能力，也就没有可数的工具。

每条 finding 带证据定位、按 ACCF effectiveness-gap 分类法给出的归类，以及会推翻它的观测。

## 边界

源码里的注册站点只说明能力被声明了，不说明它能用。

调用计数描述的是被扫描的那些日志。未扫描的 profile、日志窗口之前的调用都会读成未使用；会话变长，计数也会漂移。

第一方包随 harness 发行，不参与搜索。报告把它们记为 shipped，不报缺失。

扫描匹配一组固定的调用模式，报告里列出了这组模式。用其他调用点注册的包会被误报。

字段 `generated_from.preset_roots_searched` 逐条列出本次运行看过的 skill 根。某个根没被解析到，意味着它的 skill 不在报告里，不意味着它们没被使用。

报告不含语义判断。

## 消融

```js
import { collect } from "dsh-consumer-audit/collect";
import { ablation } from "dsh-consumer-audit/audit";

const input = collect({ dshHome, profileDir });
console.log(ablation(input));
```

关掉消费者计数时，需要计数的工具与 skill 记作未评估。把输入置空的那种消融看起来差异很大，实际什么也证明不了。

## 验证

仓库根目录一条命令重跑全部检查：

```powershell
.\tools\run-evidence.ps1
```

它依次检查：市场 entry 的机械要求、市场自己的目录解析器与安装解析器、两份 README 与 `SKILL.md` 的写作特征、插件契约在三种上下文下的行为、`npm pack` 后隔离安装的副本、对首个 finding 的独立重数，以及受跟踪文件里有没有本机信息。任何一节失败，脚本以非零码退出。

当前数字与逐条描述见 [EVIDENCE.md](EVIDENCE.md)。README 不抄这些数字，它们每次运行都会变。

**尚未验证**：装好后由 DSH loader 真正加载这一环。包是通过对它导出的 `apply()` 传入一个记录型上下文来跑的，导出形状取自本机两个确实能加载的插件。

## 仓库结构

```
lib/audit.js     对一份普通清单做判定，无 I/O
lib/collect.js   读 DSH_HOME，产出那份清单
lib/index.js     注册工具与 skill
skills/          skill 正文
tools/           各项检查与发布脚本
market/          提交进精选列表的条目文件
```

## 许可

MIT
