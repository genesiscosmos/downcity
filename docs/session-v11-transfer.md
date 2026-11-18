<!-- 正式 schema11/format3 单记录转移契约；用户命令在 homepage 中英文离线迁移页。 -->

# Session v11 单记录转移

当前 `export-session.mjs` / `import-session.mjs` 只接受 DB schema11、目录包 format3；导入批次 format3 并显式绑定 schema11。Tool disclosure1、ResultRef2、附件所属清单2保持独立版本。永久 session_id 保留，仅同 Agent 跨根转移；不设置主指针，不覆盖记录、不自动改 ID。

包目录0700、JSON文件0600，单JSON上限256 MiB。manifest封闭字段：format_version=3、schema_version=11、agent_id、session_id、export_operation_id、request_hash、allow_unresolved_sources、source_attachments、record_sha256、attachments、sources、status。request_hash绑定除status及自身外的全部字段，正式加载仅接受ready。record仅metadata/configuration/messages/message_parts/composer_checkpoints，不携带session_key、主指针、receipt、归档计划或执行权。

正式schema/codec验证每条记录的字段、连续Part、水位/Step边界、checkpoint外键及语义往返。completed/failed Tool必须保存JSON model_output（null合法）、disclosure_version=1及匹配实际结果摘要的ResultRef2；缺省、未知版本或冲突拒绝。读取历史、fork或导入不重新计算披露，不补造首次视图。

附件清单逐项relative_path/bytes/sha256/source_media_version；加载包不读取source_attachments原路径，只用于URL归属判定。只重绑所属file/inbox URL、媒体版本及精确路径提示；Tool正文/视图不替换。

导出声明writers-stopped，持根独占与Agent共享附件租约，从单个只读事务捕获canonical；拒绝未完成归档计划及旧审计/已占用operation_id。相同路径、操作、策略和源内容可重入。导入要求目标v11库已经存在、owner/readiness通过；缺库不创建。全根任意Agent已有UUID、retired、cleanup、历史receipt/创建键/归档占用拒绝复活。

来源覆盖fork、结构化origin、消息/Inbox meta及Tool ResultRef；只在当前Agent权限内精确解析。缺失默认阻断，显式allow-unresolved只保留准确原引用和计数；存在但身份/分类/摘要冲突仍拒绝。本地复制结果需匹配直接来源消息、Part、保存引用及摘要；无法证明的多级来源需回到原引用的权限边界。

导入批次保存planned/request_hash及copying/publishing/files_published/committed状态。planned包含format3/schema11、operation_id、根、Agent、UUID、包路径/摘要、来源策略及附件。目标Agent内stage owner绑定原操作及request_hash；附件整体rename后DB单事务提交canonical/config/checkpoint/创建键/业务水位/receipt。COMMIT后ACK丢失从原receipt核对结算，所有重入重新校验附件及canonical；不覆盖未知目录、不更换操作ID接管、不自动删除未完成批次。

独立 `convert-session-package.mjs` 通过冻结v10/v9协议读取format3/schema10或format2/schema9，并校验每条Tool首次证据；完整快照/引用/canonical/checkpoint原样保留到format3/schema11。缺字段、未知披露版本、摘要冲突或无法证明的外部ResultRef在创建指定输出前阻断。format1/schema8先在隔离临时根完成UUID身份转换，清空派生checkpoint并返回数量，再执行同样的v10证据门禁。源包保留，不访问源根。新输出目录失败现场需独立审阅，不覆盖或自动接管。
