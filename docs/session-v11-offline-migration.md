<!-- v11 迁移的开发边界；用户命令与恢复说明位于 homepage 中英文离线迁移页。 -->

# Session v10→v11 离线转换

本文描述固定的历史 v10→v11 阶段。当前正式格式为 v12；完成本阶段后须继续执行 [v11→v12 离线转换](session-v12-offline-migration.md)。本工具的目标协议由冻结的 v11 loader 提供。

Agent 存储拥有 `AGENT_SESSION_SCHEMA_VERSION` 和 `assert_agent_session_schema`；City 根门禁复用该规则，只额外校验根标记、历史分区与跨 Agent UUID。错误保留 `session_migration_required` 前缀并附带路径、Agent 和实际/目标版本。读取及启动均不隐式迁移。

v11 放宽 `messages.meta` 对 Agent 消息的限制，允许保存 `current_error`。`session-v11-conversion.mjs` 从冻结 v10 schema/codec 校验源库，在私有 SQLite 一致性副本内重建 `messages` 和 `storage_metadata`。先临时保存行，再以原表名创建正式 DDL；复制完成后恢复触发器，避免 RENAME 改写外部引用或触发重复业务写入。正式 DDL、全部消息解码、完整性和外键全部通过后提交。

`content_sha256` 按主键流式覆盖每个表、每个字段及 sqlite_sequence，只将 storage_metadata.format_version 归一化为 11。源/目标该摘要必须一致。消息、Part、时间、水位、工具结果、配置、检查点、UUID、创建键、receipt、归档计划和附件保持。

`migrate-session-sqlite-v11.mjs` 提供 preflight/apply/status/verify/restore。预检只读源，清单绑定源指纹、内容摘要、计数、附件清单、完整 Agent 范围及迁移身份。apply 持根独占与全部 Agent 文件独占租约，先备份全部源，再转换全部 stage，验证完成后才以本批 migrating 标记逐库原子发布，最后写 v11 ready。发布和恢复确认丢失可按同一批次继续；源、目标、附件或计划变化均拒绝。restore 仅接受尚未发生业务写入的完成批次，保留全部原始/暂存副本并恢复原始根标记。

v9→v10 工具改用冻结的 v10 loader，历史批次不随当前运行时版本升级。单记录转移保持独立包 format3 / 导入批次 format3，显式绑定 schema11；schema10/format3 包由独立包转换入口验证并转换，正式导入不分支兼容旧格式。
