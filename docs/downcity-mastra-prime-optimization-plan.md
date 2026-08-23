# Downcity 优化方向：基于当前实现的能力演进方案

> 状态：设计基线
>
> 目的：把 Mastra 与 Prime Agent 的可借鉴能力，转换为符合 Downcity 当前架构、所有权和生命周期的优化计划。
>
> 范围：`packages/agent`、`packages/plugins`、`packages/agent` 及其用户文档。
>
> 本文只描述当前代码可以证明的缺口和可落地的演进方向，不把外部项目的实现方式直接当作 Downcity 的目标架构。

## 1. 结论先行

Downcity 当前并不是缺少“人类交互暂停”或“memory 能力”：

- Session 已有通用 Interaction 协议；Shell 审批和 `ask_question` 都能在同一个 Turn 内等待用户响应并继续执行。
- `@downcity/plugins/memory` 已有内置 Markdown/LLM Wiki 风格实现，支持检索、读取、记住、digest 和 revise。
- City 已有媒体输入触发的模型 fallback，但不是完整的 Provider 故障回退系统。
- City 已记录模型级 AI usage，但记录中尚无 Session、Turn、Tool Call 或子 Agent 归因字段。

因此，优先级应从“新增概念”调整为：

1. 统一并持久化已有 Interaction/审批能力；
2. 明确 memory 的可替换边界，而不是直接创建一套大而全的记忆平台；
3. 把通用 Provider fallback、评测和用量归因建立在可观测数据契约上；
4. 在跨进程恢复尚未验证收益前，不承诺完整 shell/PTY 执行现场恢复。

## 2. 当前实现基线

### 2.1 Session、Turn 与用户交互

`Session` 负责 Prompt、Stop、Compact、Interaction 和状态查询；`SessionLoop` 负责 FIFO、Turn 生命周期和 Executor 调用。

当前已经具备：

- `stop()`：中止当前 Turn，取消排队 Prompt，并取消 pending Interaction；
- `SessionInteractions`：创建、持久化、列出、响应、过期和取消 Interaction；
- `SessionShellApprovalAdapter`：把 Shell 高风险操作映射为通用 approval Interaction；
- `ask_question`：作为普通 Tool 发起 question Interaction，收到回答后在原 Turn 继续。

证据：

- `packages/agent/src/session/Session.ts`
- `packages/agent/src/session/SessionLoop.ts`
- `packages/agent/src/session/control/SessionInteractions.ts`
- `packages/agent/src/session/execution/tools/SessionShellApprovalAdapter.ts`
- `packages/agent/scripts/session-shell-approval.test.mjs`
- `packages/agent/scripts/session-ask-question.test.mjs`

尚不具备：

- 用户主动 `suspend()` / `resume()` API；
- 进程退出后恢复正在执行的 Turn；
- Shell/PTY、第三方 Tool、副作用事务的可序列化执行现场；
- 跨机器恢复所需的 lease、幂等和所有权协议。

### 2.2 Memory

当前 `MemoryPlugin` 是一个真正存在的公开插件，不应再以“Downcity 没有 memory”为前提规划。

当前实现特点：

- `wiki`：整理后的长期知识；
- `source`：原始证据和 session digest 归档；
- `working`：类型和搜索结果中的概念，但当前没有独立的完整 working-state 存储协议；
- 默认 backend 是本地 Markdown 扫描，不是向量数据库；
- LLM 能力通过 `digest` / `revise` handler 注入，插件本身不绑定具体模型。

证据：

- `packages/plugins/src/memory/MemoryPlugin.ts`
- `packages/plugins/src/memory/types/Memory.ts`
- `packages/plugins/src/memory/runtime/Store.ts`
- `homepage/content/plugins-docs/zh/builtins/memory.mdx`

当前缺口不是“实现 memory”，而是：

- 没有稳定的外部 Memory Adapter Port；
- 没有统一的后端能力、错误、超时和一致性语义；
- 没有 memory 数据删除、导出、租户隔离和权限模型；
- 没有 recall 质量基准。

### 2.3 City fallback 与 usage

`packages/agent/src/service/ai/model-routing.ts` 已存在媒体输入 fallback：规则根据媒体类型匹配备用模型，并记录 `fallback_from`、`fallback_reason` 和 `fallback_media_type`。

这不等于通用服务端 fallback。当前仍缺少：

- Provider 超时、限流、5xx 和不可用状态的重试/回退策略；
- 按错误类型区分可回退与不可回退；
- 多级 fallback 的循环检测和预算上限；
- fallback 后的 usage、计费和最终结果幂等结算证明。

`AIUsageRecord` 已记录用户、Bureau、Action、模型、上游模型、Token、时长和结果，但没有：

- `agent_id`、`session_id`、`turn_id`；
- `tool_call_id`、`plugin_name`；
- parent execution / child execution 关系。

因此，子 Agent 用量归因不能只新增报表，必须先演进 usage 事件契约。

## 3. 设计原则

### 3.1 先复用现有边界

新的能力优先放入已有拥有者：

```text
SessionInteractions  → 用户等待、审批和恢复
SessionLoop           → Turn/Command 编排
MemoryPlugin          → memory 业务语义
Memory Adapter        → 外部后端适配
City AIService        → 模型路由、usage 和结算
Plugin                 → refine 等可选能力
```

不新增万能 `RuntimeManager`、全局 `MemoryService` 或跨 package Service Container。

### 3.2 区分“同 Turn 恢复”和“执行现场恢复”

用户审批后的继续执行已经存在；真正的新能力是：

- 进程内主动暂停并继续；
- 崩溃后从持久化检查点恢复；
- 跨进程恢复可重建的执行现场。

三者不能使用同一个模糊的 `resume` 语义。

### 3.3 插件化不等于接口先行

Memory 只有在出现第二个真实后端、并且两个后端的共同不变量已经明确后，才冻结公开 Adapter Port。先定义数据、权限、删除、错误和生命周期，再决定接口最小面。

### 3.4 评测必须服务于决策

Evals 不以“有一个新 package”为目标，而以回答具体问题为目标：

- 压缩后是否保持关键事实？
- 审批拒绝是否绝不执行副作用？
- memory recall 是否找到正确证据？
- fallback 是否保持结果、计量和结算一致？

## 4. 优化路线

### P0：收敛已有能力（30 天）

#### P0.1 统一 Tool Interaction 与审批策略

目标不是给 Agent 增加审批配置，而是让任意 Tool 直接使用 AI SDK 原生 `needsApproval` 声明需求，
由 Runtime bridge 把模型的真实 Tool Call 接入 Session Interaction：

- `tool_name`、`tool_call_id`、`turn_id`；
- schema 校验后的 `validated_input`；
- Tool 自带的 `tool_description` 与可选 `model_explanation`；
- approved / denied / expired / cancelled；
- 审计记录与 Tool Result 的一一对应。

普通 Tool 审批不要求开发者填写 `title` 或 `reason`：UI 根据真实 Tool、结构化输入和可选
模型解释组织展示。Shell 审批仍保留命令、cwd 和安全原因，两者在类型上明确分开。

第一阶段只支持“调用前审批”，不支持模型流中途或任意指令级暂停。

验收：

- 自定义 Tool 可以声明需审批；
- 拒绝、过期和取消都不会执行 Tool 副作用；
- 批准后在原 Turn 内继续；
- Shell、`ask_question` 和自定义 Tool 共用同一 Interaction 事实源；
- 增加公开入口集成测试。

#### P0.2 定义 Memory Adapter 研究协议

先不冻结 `remember/recall/observe/working/history` 五件套。先定义一个最小研究端口，覆盖：

- `search`：返回结果、来源、引用和相关性元数据；
- `write`：写入一条带来源的记忆；
- `read`：读取稳定版本的记忆对象；
- `delete`：按记忆身份删除；
- `health`：报告后端可用性和能力。

先用现有 Markdown backend 做 adapter，再实现一个真正独立的第二后端。只有两者不变量稳定后，才进入公开 API。

验收：两个后端可以替换而不修改 Session、Executor 和 Plugin action；失败、超时和删除语义有测试。

### P1：建立可信度基础设施（90 天）

#### P1.1 建立独立 evals 能力

建议新建 `packages/evals`，但仅在数据模型先稳定后实施。第一批能力：

- dataset：输入、期望事件、期望结果和版本；
- scorer：工具调用、压缩保持度、审批安全性、memory recall；
- runner：本地和 CI 执行；
- report：机器可读 JSON 与人类可读 Markdown。

验收必须包含固定数据集、可重复运行、失败样本和阈值，不以“CI 运行成功”作为唯一标准。

#### P1.2 明确 Provider fallback

保留现有媒体 fallback，并新增独立的错误回退策略。策略必须由 City AIService 拥有，至少定义：

- 哪些错误可回退；
- 最大尝试次数和总时限；
- fallback 链循环检测；
- 最终模型和原模型 usage 的结算方式；
- 每次尝试与最终结果的关联。

不要把 provider retry 逻辑塞入 `model-routing.ts`；该文件当前职责是媒体路由，不是执行恢复器。

#### P1.3 refine 作为可选插件

只允许插件提交改进候选，不允许 Agent 静默改写 base prompt 或运行时根配置。候选必须包含：

- 版本；
- 来源和证据；
- 变更内容；
- 审批状态；
- 可回滚的前一版本。

第一阶段只支持 skill 或 memory 文档变更，不支持修改可执行代码、权限策略和基础模型配置。

### P2：验证长期运行能力（180 天后）

#### P2.1 Session 检查点与恢复

先实现 Turn 边界检查点：消息、工具事务状态、pending Interaction、配置快照和 usage correlation 一起提交。只有检查点经过崩溃恢复测试后，才考虑跨进程恢复。

明确不可恢复对象：正在运行的外部进程、不可重放的网络副作用、未确认的第三方事务。对这些对象必须返回“需要人工重试/补偿”，不能伪装成透明恢复。

#### P2.2 子 Agent 句柄

在 `RemoteAgent` 之上新增句柄协议，而不是修改现有 plugin action 的同步结果含义。句柄至少包含：

- `handle_id`；
- owner session；
- parent handle；
- 状态、取消和过期时间；
- 结果引用，而不是无限嵌套结果。

与 `ActionSchedule` 组合前，先完成断线、重复查询和权限继承测试。

#### P2.3 用量归因

先在 Agent 执行事件中生成稳定的 attribution context，再由 City 接收并落盘。报表只是最后一层投影：

```text
Agent Turn/Tool Event
  → usage correlation
  → City AIUsageRecord
  → session tree aggregation
```

不能从文本 JSONL 通过启发式推断计费归属。

#### P2.4 AST edit / LSP

在现有 `edit` 工具上增加明确的结构化编辑模式，保留文本编辑模式。AST/LSP 依赖应由能力包或可选插件拥有，不能让基础 Agent 默认捆绑完整语言服务器生态。

## 5. 暂不做

- Prime 风格的单工具 IPython REPL：当前结构化 Tool 面的 schema、审批和审计价值更明确。
- 任意 shell/PTY 的透明持久化：外部进程状态不可安全序列化，先做边界检查点。
- 自研完整向量/知识图谱 memory 平台：先验证 adapter 不变量和真实后端需求。
- 只为“对标 Mastra”新增大量内置 package。
- 通过 2,000 行阈值替代现有 800–1000 行模块纪律。

## 6. 依赖与交付边界

| 交付项 | 所有者 | 依赖 | 对外影响 |
| --- | --- | --- | --- |
| Tool 审批统一 | `packages/agent` + `packages/shell` | 现有 Interaction | Agent API/行为变化 |
| Memory Adapter 研究端口 | `packages/plugins` | 当前 MemoryPlugin | 先内部，冻结后需文档 |
| Evals | 新 `packages/evals` | Agent 公开事件和测试模型 | 新 package |
| Provider fallback | `packages/agent` | AIService usage 结算 | City 行为变化 |
| 子 Agent 句柄 | `packages/agent` | Remote transport/RPC | Agent/RPC 协议变化 |
| Usage attribution | `packages/agent` + `packages/agent` | 相关事件契约 | 多 package 公开变化 |

任何公开 API 或用户可见行为落地后，必须按 `AGENTS.md` 运行对应 patch/build、typecheck、测试和用户文档构建。

## 7. 统一验收清单

每项能力都必须验证：

- 正常路径；
- 拒绝、取消、过期和超时；
- 进程 dispose；
- 持久化写入失败；
- 重复提交和重复恢复；
- 真实 package 根入口；
- 中文/英文用户文档示例；
- 公开 API 命名和类型字段注释；
- 模块行数和依赖循环门禁。

## 8. 最终判断

Downcity 当前最值得借鉴的不是 Mastra 或 Prime 的某个类，而是它们暴露出的产品问题：

- 用户等待必须成为执行协议的一部分；
- memory 需要可替换，但不应提前平台化；
- 评测和计量必须成为基础设施事实，而不是宣传口号；
- 长期运行必须先定义可恢复边界，再讨论 durable execution。

Downcity 的实现顺序应始终遵循：

> 先确认现有事实源，再补领域缺口；先定义所有权和失败语义，再增加公开 API；先用真实测试证明价值，再扩大抽象范围。
