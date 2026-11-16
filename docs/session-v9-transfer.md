<!-- 隔离历史 schema9/format2 协议；当前正式协议为session-v10-transfer.md。 -->

# Session v9 历史转移协议

本文仅供隔离历史 loader 校验 schema9/format2 包与批次，不是当前通用入口的使用说明。正式 export/import 使用 [v10 转移协议](session-v10-transfer.md)；历史包必须通过独立 `convert-session-package.mjs` 的首次披露证据门禁后才能导入。以下字段描述冻结的历史事实。

## 包格式

目录权限 0700，JSON 文件权限 0600，单个 JSON 最大 256 MiB；路径、链接、额外文件及附件预算由严格文件枚举校验。

- `manifest.json` 封闭字段：format_version=2、schema_version=9、agent_id、session_id、export_operation_id、request_hash、allow_unresolved_sources、source_attachments、record_sha256、attachments、sources、status。request_hash 为全部不可变字段的 canonical SHA256（排除 status 和 request_hash）；status 仅 copying/ready，正式加载只接受 ready。
- `record.json` 封闭字段：metadata、configuration、messages、message_parts、composer_checkpoints。内部 session_key 不导出，字段和约束由正式 schema/codec 及语义往返校验。稳定 Part 水位不能越过未完成内容或截断 Step。配置中的 creation_key 在目标同事务建立映射。
- `attachments/` 按相对路径保存独立副本。manifest 中每项只有 relative_path、bytes、sha256、source_media_version，验证实际内容/清单完全相等。
- sources 从 canonical 重新提取，覆盖 Session origin、fork、消息/Inbox meta 和 Tool ResultRef。包不携带其他 Session 的正文、归档计划、主指针、receipt 或执行权。

source_attachments 仅用于确定 URL 所属，加载/导入绝不读取该原路径。导入仅重绑该范围内的绝对路径/file URL、媒体版本及精确附件路径提示，Tool 正文/披露/任意用户文本不替换。

## 操作与恢复

导出声明 writers-stopped，持 RootLease + Agent 共享附件租约，读取单个一致性事务，拒绝参与未完成归档计划的 Session 与旧审计/业务占用 operation_id。记录/附件/所属/来源校验完成后写新包，持租约直至复制完成并复核。相同包位置、操作 ID、策略和内容可重入，改变源或操作拒绝。

导入持 RootLease + Agent 排他附件租约。目标库必须存在，schema/owner/readiness 校验通过，跨 Agent 只读扫描检查目标 UUID 及历史占用；缺库不创建。活动/归档同 UUID、retired、cleanup、receipt、创建键和归档节点/根身份拒绝复活。legacy_operation_ids 的旧操作不能重放。

外部来源只在当前 Agent 权限内精确读取。缺失默认阻断；allow-unresolved-sources 只允许保留未解析的精确历史引用并计数，不扩大权限、不猜最近同名会话。已经存在但分类/消息/结果摘要冲突仍拒绝。本地复制结果必须匹配来源消息、Part、原引用及内容摘要。

导入批次 `import.json` 保存 format_version=2、planned、request_hash 和 copying/publishing/files_published/committed 状态。planned 绑定 operation_id、根、Agent、session_id、包路径/摘要、allow-unresolved 和附件清单。stage 位于目标 Agent `.session-imports/<operation_id>/`，owner.json 绑定同 operation_id+request_hash。完整附件及 v2 所属清单校验后整体 rename 至 `session-files/<session_id>/`，然后 DB 事务插入 canonical/config/checkpoints/创建键、first_business_write_at 和 receipt。COMMIT 后 ACK 丢失从同库 receipt 结算，不重复插入；重入重新核对文件与 canonical 摘要。失败现场不自动删除，不更换操作 ID接管，不覆盖未知既有目录。

## 隔离转换范围

format 1 包由固定 v8 DDL 在临时根重建源库，转换器复用 v9 源 UUID 提升与 canonical ResultRef 摘要校验。仅来源自包含的包可转换；外部记录 canonical 证据不足时拒绝，需要受审阅全根转换。派生 Composer checkpoints 清空并返回数量，原包保留。输出必须是新目录，部分输出不自动续跑/覆盖，需独立审阅。

该转换器不提供 SDK 运行时旧字段 alias，不访问真实运行根，也不改变 Tool 字段可选性、持久格式或终态语义。
