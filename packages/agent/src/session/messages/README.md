# session/messages

消息领域：canonical Message 的写入、状态机，以及由它派生的通知与用户交互。

`session.db` 是唯一事实源，本目录所有写入都必须经过 `SessionMessages`；其余模块只
在它的编排下工作，不各自直连存储。

## 内部层次

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 领域入口 | `SessionMessages.ts` | 唯一对外入口：写入、恢复、有界运行态投影 |
| 写入 | `SessionAgentMessageWriter.ts`、`SessionAgentMessageState.ts` | 单条 Assistant Message 的流式组装与终态收口 |
| 结构 | `SessionAgentContent.ts`、`SessionAgentParts.ts`、`SessionUserMessage.ts`、`SessionUserContext.ts` | Part 构造与归一 |
| 门禁 | `SessionToolPartGate.ts`、`SessionMessageState.ts` | Part 状态合法性与 Message 状态转换 |
| 投影 | `SessionMessageText.ts`、`SessionMessageCache.ts`、`SessionMutationFactory.ts`、`SessionMessageTimeline.ts` | 文本提取、运行态缓存、Mutation 构造、时间线事件 |
| 输出适配 | `SessionAssistantOutputAdapter.ts` | 把模型事件转交给 Writer |
| 文件 Diff | `SessionTurnFileDiffData.ts`、`SessionForkMessageFiles.ts` | 结构化文件修改的 canonical data part 与 fork 附件迁移 |
| 通知 | `SessionEventHub.ts`、`SessionModelRequestWarning.ts` | Mutation 订阅广播；内部失败到公开 Mutation 的唯一转换 |
| 用户交互 | `SessionInteractions.ts`、`ApprovalInteraction.ts` | 通用交互原语；审批入口 |
| 工具 | `SessionJsonValue.ts` | JSON 值窄化 |

## 关键约束

- 任何终态都必须先提交 canonical Message，再兑现等待中的 Promise。
- 内部模型请求失败不直接暴露：统一经 `SessionModelRequestWarning` 转成公开 Mutation。
- `SessionInteractions` 不拥有 Interaction 状态，它只拥有进程内 waiter。
