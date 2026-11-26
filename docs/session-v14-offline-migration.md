<!-- v14 离线转换的源核验、最终结构和数据保留边界。 -->

# Session v13 → v14 离线转换

入口为 `scripts/migrate-session-sqlite-v14.mjs`。目标结构唯一来自当前 Agent 的 `AGENT_SESSION_SCHEMA_SQL`，运行时仅使用最终 v14 协议。

## 数据转换

- 从只读源库在私有批次中创建全新的 v14 暂存库，不复制旧库的表结构。
- 删除 `session_configuration.model_binding`，包括非空旧配置，不迁入其他字段。
- 删除宿主专用的 `agent_session_state` 表。有效主会话指针写入 `agent_variables` 的 `desktop.main_chatroom`；空指针不创建变量。
- 将数据库 `user_version`、`storage_metadata.format_version` 和根标记统一为 14。
- 其余业务字段原值写入，包括内部 `session_key`、永久 UUID、消息与 Part 的原始 JSON、稳定水位、其他配置、检查点、归档记录、操作回执及退休身份。
- 附件及其所属清单保持原路径和原文件。

## 源核验与发布

源库必须为 ready v13。完整 DDL 核验只接受冻结的 v13 定义，或在 `session_configuration` 中仍包含原 `model_binding` 定义的 v13 来源。此识别仅属于一次性离线读取，不向运行时增加旧字段、双写或兼容 API。其他表、字段、索引、触发器或约束变化仍会阻断。

全部源库先由现有批次框架完整备份，再转换全部暂存库，全部验证成功后才发布。写入暂存库期间暂停触发器与外键即时检查，随后恢复正式触发器，并验证完整 DDL、SQLite 完整性、外键、消息 codec、消息数量及全表内容摘要。摘要只投影上述明确列出的版本、变量和废弃字段变化。

`--preflight` 不修改源数据；不指定 `--batch` 时只输出报告。创建批次必须使用尚不存在的根外私有目录，不能复用已 blocked 的预检目录。`--apply` 与 `--restore` 要求已停止宿主和全部写进程，并显式传入 `--writers-stopped`。工具不管理进程。

中断后使用原批次继续。暂存验收失败时不发布任何数据库；源变化会阻断发布。原始备份保留，恢复仍要求尚无后续业务写入或附件变化。

## 验证

执行 `node --test scripts/migrate-session-sqlite-v14.test.mjs`，覆盖两种 v13 来源统一重建、非空旧字段删除、逐表业务比较、附件不变、最终触发器、备份恢复、异常 DDL 与损坏数据拦截、失败重试、源变化拒绝及完整 CLI 流程。测试仅操作系统临时目录。
