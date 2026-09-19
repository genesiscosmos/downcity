# session/loop

轮次编排：一次 `prompt()` 从入队到收口的全过程，以及驱动它所需的配置状态。

## 文件

| 文件 | 随轮次销毁 | 职责 |
| --- | --- | --- |
| `SessionLoop.ts` | — | 队列消费与 Turn 生命周期所有者 |
| `SessionQueue.ts` | — | 进程内 FIFO，只保存 Command 与顺序 |
| `SessionTurnContext.ts` | 是 | 一个 Turn 的执行上下文：身份、生命周期、Step、输入输出协作 |
| `SessionTurnCompletion.ts` | 是 | 结果映射、Turn Mutation、committed Hook 与 Context 释放顺序 |
| `SessionTurnFileDiff.ts` | 是 | 把 Tool effects 投影为实时摘要与最终 canonical data part |
| `SessionTurnFileDiffBuilder.ts` | 是 | 从 Tool effects 中只选出 Workspace 文件修改事实 |
| `SessionState.ts` | 否 | 配置与 Metadata 状态；跨轮存活，写 `session_state` 表 |
| `SessionTitle.ts` | 否 | 标题生成与持久化 |
| `SessionTitleTask.ts` | 否 | 标题后台任务；不得阻塞 Turn 主链路 |

## 为什么配置状态和轮次编排同处一室

`SessionState` 与 `SessionTitle` 不随轮次销毁，但它们的驱动者只有 `SessionLoop`：
配置在开轮时读取，标题在轮末生成。`SessionLoop` 直接持有 `this.state` 并在检查点
使用它，拆成两个目录只会让这条唯一驱动关系变得不显眼。

## 关键约束

- Queue 是唯一的输入顺序权威；Prompt 与维护类 Command 共用同一条 FIFO。
- `SessionTitleTask` 是 metadata 增强任务，失败只记日志，不改变 Turn 结果。
