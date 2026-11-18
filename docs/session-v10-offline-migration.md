<!-- 严格首次披露证据的离线协议；实际用户命令在homepage中英文离线迁移页。 -->

# Session v9→v10 离线终态转换

`migrate-session-sqlite-v10.mjs`只解释正式schema9源库与独立v10批次。冻结v9 loader不使用当前codec解释旧Tool缺省字段；本工具目标固定schema10，使用冻结的v10 loader；正式runtime仅接受schema11，需继续执行v10→v11转换。v8→v9身份转换继续使用冻结v9目标、UUID保留与原identity_policy；不能把已有批次改标为v10。

Node>=22.18、安装工作区依赖，从public目录执行。所有命令要求显式root，不默认读取用户运行根。preflight不写源：不带batch输出结构化证据报告，带新batch在根外创建0700目录及0600 `manifest.json`。apply只接受已经保存并审阅的原计划及writers-stopped声明；工具不管理进程。

清单绑定format10/source_schema9/target_schema10、`terminal_policy=preserve-proven-first-disclosure-v1`、migration UUID、原root marker、Agent全范围、源逻辑指纹、附件完整树摘要、逐Tool证据、水位、checkpoint数量与覆盖范围、blockers及plan_hash。工具诊断不包含Tool正文或模型视图。缺字段、未知版本、非JSON/超预算视图、无效ResultRef、Part/结果摘要/来源冲突及无法证明的外部结果阻断apply，保留源事实。JSON null合法。已有完整快照逐值保留，不调用披露算法；包括历史nullish结果摘要冲突在内都不能修引用冒充原视图。

源DDL、拥有者、完整性、canonical连续序号及稳定前缀通过冻结v9协议验证，目标通过当前schema/codec验证。运行中Tool允许没有终态字段；转换保持其运行态，新库首次恢复使用统一终态构造收口。所有已终态固定视图不可在线重算。当前转换要求已有完整引用，不补齐缺引用的旧记录。

apply持RootLease与全部Agent排他文件租约；先逐库核对源指纹并通过SQLite backup保存包含已提交WAL的一致性备份，再构建stage。默认严格策略仅将storage_metadata格式约束/值与PRAGMA改为10；其余表、canonical、稳定水位、checkpoint、cursor secret、generation、UUID、receipt、归档计划、队列及附件均原样保留。正式DDL与目标DDL有其他差异时目标完整schema校验拒绝，不借此执行附加迁移。

全部stage验证后写本批次所属`migrating`根标记并发布，逐项ACK绑定源和目标指纹。发布前后都核对备份与附件；完整目标通过后写ready。相同apply可恢复rename后ACK丢失；其他批次、策略或变化的源拒绝。中断stage在本批原始备份仍匹配时可重建；未完成import需先独立审阅。

status只读清单；verify只读检查本批ready marker、完整scope、原始备份、已发布指纹和当前codec，不初始化或修复。restore只接受完成或正在恢复的原批次，在全部原备份、目标及附件无业务变化时覆盖；已有新写入则拒绝。恢复同样在owned restoring标记下进行，逐项指纹结算，最后恢复原marker（原来不存在则移除）。原始与stage不自动删除，业务写入后的备份仅供独立人工恢复。

## 显式审阅恢复策略

默认仍为 `preserve-proven-first-disclosure-v1`。用户接受历史模型视图发生变化时，可在 preflight 使用 `--recover-reviewed` 新建策略为 `rebuild-reviewed-terminal-snapshots-v1` 的批次，并在每次 apply 使用相同选项。严格批次不能原地改策略，status/verify/restore 不接收该选项。

恢复只处理缺失终态快照字段或超预算模型快照。通过当前纯协议生成迁移时快照，完整合法旧快照原样保留；原始 output/error、身份、水位、时间、receipt、队列和附件不变。已有引用必须匹配原 Part 和结果摘要，缺引用时绑定本地 canonical 位置；未知披露版本、缺原始结果、引用/来源冲突继续阻断。冻结 v9 codec 只用于解释未转换的外部源 canonical，不授予正式 runtime 读 v9 的能力。

引用收集只覆盖正式 result_ref、output、model_output，历史 input/input_text 原文不参与结果寻址。单轮 record 内缓存解码结果，避免一条长消息的每个 Tool 再次解码整条消息；缓存不跨快照或记录复用。

每条重建记录保存 `migration-rebuilt-snapshot`、原因、源/目标 content 摘要、结果及模型快照摘要、是否新建引用。清单另记受影响检查点的身份与源摘要；覆盖重建 Part 的检查点失效，较早检查点保留。报告不含工具正文或模型内容，所有原文仍在原始备份中。每个 Agent 的 `proof_sha256` 绑定重建输出，apply 在原始备份上重新推导并比对，算法变化后必须重新预检。

恢复更新仅发生于隔离 stage；单事务临时移除稳定内容更新触发器，完成精确 Part 更新及检查点删除后恢复原触发器定义，再以完整正式 DDL、codec、来源引用及完整性校验。源库的稳定水位和触发器不修改。发布、重入、verify、restore 沿用原流程，根标记和批次拥有权绑定各自策略。

真正运行根的 apply、restore 及部署启停按用户授权范围执行；仅实现恢复能力和审阅预检的确认，不包含真实源库转换。
