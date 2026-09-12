# dsh-consumer-audit

[English](README.en.md) | 中文

你装的插件或 skill 注册了某项能力，但注册成功不代表模型真的调用过它们，也不代表它们设计的内容真的实际生效了，而这件事模型根本不会主动报告。这个插件负责把它报出来。

## 它解决什么

DSH 的插件可以向宿主注册工具、skill、服务和路由。注册成功不等于模型会调用它们。

一个插件可能在启动时安静地注册了三个工具，其中两个在过去几十次会话里一次都没被调用过。代码在，测试过，加载正常，只是没有任何任务走到那里。还有一类更隐蔽：插件只包裹了宿主已有的方法，什么都不注册，从清单上看它像什么都没做，实际上它确实在生效。

`consumer_audit` 把这件事变成一份可核对的清单。它读取活动 profile 的组成行，解析每一行装的是哪个包，静态扫描该包的注册站点，再去 `DSH_HOME` 下的会话日志里数每个已注册工具和 skill 出现过几次，最后报告计数为 0 的那些。

## 一份报告长什么样

在装了 8 个插件的 profile 上跑一次，得到这样的结构（插件名换成中性写法）：

```
generated_from
  rows              8     已声明的组成行
  sessions_scanned  16    实际扫描的会话日志份数

findings
  tool_never_invoked   some-plugin/tool-x          16 份日志里 0 次调用
  tool_never_invoked   this-plugin/consumer_audit  同上，包括它自己

notes（不算问题，只是说明）
  intercepts_host_behaviour  some-plugin       只包裹宿主已有方法，没有新能力可数
  first_party_shipped        @deepseek-ai/...  随 harness 发行，不在 profile 里
```

每条 finding 都带证据定位、缺口归类和证伪条件。它长这样：

```json
{
  "kind": "tool_never_invoked",
  "object": "some-plugin/tool-x",
  "consumer_count": 0,
  "evidence": {
    "locator": "<该插件安装目录>",
    "method": "tool name searched across 16 scanned session logs"
  },
  "falsifier": "find one invocation in a session log this run did not scan",
  "classification": "consumer_verification_gap"
}
```

注意最后一栏。一条 finding 说的只是"这次扫描没看到消费者"，并附带可以推翻它的观测。它没说插件写得不好。

## 什么时候用得上

装完一个新插件，想知道它有没有在干活。怀疑某个功能写了但没接上。清理 profile 之前，想知道删掉谁不会有影响。自己写插件，想知道哪部分没人调用。

上面这些判断由模型做，它自己去跑这个插件；人只要问一句就行。

## 安装

```sh
dsh plugin --profile <profile> add github:qimen039-code/dsh-consumer-audit
```

装完需要重启 DSH，工具才会出现在模型工具表里。

如果你手工把包装进 profile，注意解析位置：DSH 的 loader 只从**活动 profile 自己的** `node_modules` 解析插件包，放在 `profiles/node_modules` 下无效，会以 `PackageOverlayNotFoundError` 启动失败。用上面的命令安装不会遇到这个问题，它写进的是 profile 的依赖图。

需要 Node 22.15 或更新版本，因为会话日志是多帧 zstd。

## 怎么读报告

报告里有六类 finding 字段。

| 字段 | 含义 |
| --- | --- |
| `tool_never_invoked` | 工具已注册，被扫描的日志里没有对它的调用 |
| `skill_never_loaded` | 盘上有 `SKILL.md`，被扫描的会话没有加载过 |
| `prompt_only_capability` | 这个包只注册提示词 |
| `row_without_capability` | 行已挂载、包也解析到了，但它什么都没注册 |
| `duplicate_prompt_section` | 两个包注册了同名的提示词段 |
| `package_unresolved` | 这一行的包既不在 profile 里，也不属于随 harness 发行的那批 |

另有两类结果记为 notes，不做判定。包名以 `@deepseek-ai/` 开头的行随 harness 发行，搜索为空说明不了任何事。包裹既有服务方法的包不注册新能力，调用计数判断不了它。

报告还有一节 `consumed`，列出确实被调用过的能力以及各自的次数。finding 回答"是不是死的"，`consumed` 回答"用了多少"。字段 `generated_from.capability_names` 标出每个包的能力名是它自己声明的还是扫描推断的，前者权威，后者可能读错。

**一条必须分清的界线**：调用次数只说明它被调用过，不说明它设计的内容真的生效了。日志里没有能证明后者的确定性信号，报告也不声称这一点。

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

**尚未验证**：市场精选列表上架。entry 文件已就绪，仓库公开，但 PR 未提。

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
