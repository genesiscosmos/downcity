<!-- 绑定历史工具版本的维护参考，不作为当前 v9 SDK 使用指南。 -->
# Session 历史格式离线维护

v8 源码基线为 public commit `070b8be3fdabf84501a5acabc3f840ab2dd8eb88`（Agent schema 8）。维护前应在独立 checkout 中检查对应脚本并安装该 checkout 的工作区依赖，不覆盖当前在途工作树，不使用真实数据验证。本次清理没有在该历史基线上重跑以下命令，以下内容仅作为绑定版本的维护参考。当前 v9 源码在访问数据前以 `v8_tool_runtime_version_mismatch` 拒绝 v8 迁移和转移工具。

当前源码将固定 v7 SQL/严格格式校验保存在 `scripts/lib/session-v7-schema.mjs`，历史桥为 `session-v7-runtime.mjs`，当前协议入口为独立的 `session-runtime.mjs`。v7 转换器仅是离线工具，其输出不能直接交给 v9 SDK。它仍共享当前纯 codec；今后协议变化时需重新验证此转换器。

## v8 全根迁移

从上述匹配版本源码的 `public` 目录执行 `scripts/migrate-session-sqlite-v8.mjs`。工具会扫描数据根下全部 Agent 的活动与归档分库，不能用筛选参数只迁移一个会话。默认是只读预检：

```bash
node scripts/migrate-session-sqlite-v8.mjs --preflight --root "$HOME/.downcity" --report ./session-v8-preflight.json
```

单个 Agent 历史较大时，规划和逐条校验仍需要在内存中保留记录。机器内存充足时，可将命令中的 `node` 改为 `node --max-old-space-size=12288`，把堆上限提高到 12 GiB；中断后使用相同批次目录与相同清单继续，不要新建批次或删除现场。

预检会校验 v5/v6/v7 schema、消息和 Part、fork 来源、附件、SQLite 完整性、可用空间及阻塞清单。出现任何 `blocked` 时，整批 apply 都会拒绝。确认报告后退出所有 Desktop、CLI 和 Agent 写入进程，再指定数据根之外的新批次目录执行：

```bash
node scripts/migrate-session-sqlite-v8.mjs --apply --root "$HOME/.downcity" \
  --batch "$HOME/.downcity-migration/session-v8-20261112" --writers-stopped --report ./session-v8-apply.json
```

apply 会取得数据根独占租约，制作包含已提交 WAL 的 SQLite 一致性备份，在 Agent 目录内的独立暂存目录构建并校验单库，保证发布时能在同一文件系统重命名。所有 Agent 发布并复核通过后才写入 v8 `ready` 标记。中断后使用同一个 `--batch` 继续；`--status` 查看清单，`--verify` 重新验证备份、目标和完成标记。迁移完成且新版本尚未产生业务写入前，可以显式执行 `--restore --writers-stopped` 回到迁移前布局。工具不会停止或启动进程，不会删除源库、附件或备份。

附件或回退保留副本在复制中途遇到空间不足时，原数据和批次清单保持可恢复；释放空间后使用同一批次继续，工具会核验暂存副本再发布，不把半份文件当作完成结果。新版本已经产生业务写入后，整批 `--restore` 会拒绝，旧备份不包含这些新增数据。

当前 Session 持有的附件独立复制到 `session-files/<storage_id>/attachments/`。Workspace 或其他 Session 的文件引用保留原地址，不因迁移增加访问权限。有效媒体披露版本在校验源文件后绑定副本，失配版本保持失配。旧格式没有可靠归档时间时，报告明确标注以原 `updated_at` 为迁移基准。已知 Composer 派生摘要从备份保留、目标中清空，由后续输入重新累积；不在迁移期间调用模型。`--repair-manifest` 可复用下文精确修复清单，源指纹变化或未消费条目均阻塞。

如果 fork 的来源会话已被移到数据根之外，可以通过 `--recovered-sources PATH` 明确纳入保留归档；工具不会自动搜索或选择备份。该文件必须是权限为 `0600` 的普通 JSON 文件，顶层仅含 `format_version: 1` 和 `sources`。每项仅含 `agent_id`、`session_id`、`category`、`database_path`（保留库的真实绝对路径）、`source_fingerprint`（完整原库逻辑指纹）和 `attachments`（每个普通附件的 `relative_path`、`bytes`、`sha256`）。这些字段共同绑定审阅过的精确来源，原始数据库身份仍须一致。来源按归档导入 v8，不放回旧分库；当前根存在同归档地址时拒绝覆盖。apply 和中断后继续均须提供同一份修复清单及保留归档清单。

查看原批次并验证，或在尚未业务写入时显式回退：

```bash
node scripts/migrate-session-sqlite-v8.mjs --status --root /path/to/data-root --batch /path/to/private-batch
node scripts/migrate-session-sqlite-v8.mjs --verify --root /path/to/data-root --batch /path/to/private-batch
node scripts/migrate-session-sqlite-v8.mjs --restore --root /path/to/data-root --batch /path/to/private-batch --writers-stopped
```

保留归档中的附件若使用该副本的绝对路径，也会按已审阅的附件清单重绑到导入后的记录 UUID；不会让新记录继续依赖旧副本中的所属附件。

## 旧分库 v7 工具

以下工具只升级旧分库内部结构，不完成 v8 合库。已在 v8 工具中通过全部转换校验的分库无需先单独执行它。

## 准备与预检

工具位于 Downcity 源码仓库的 `scripts/migrate-session-sqlite-v7.mjs`。使用 Node.js **22.18 或更新版本**，并安装源码工作区依赖。下面命令从包含 `scripts` 与 `packages` 的源码仓库根目录执行；联合工作区中先进入 `public`。当前工具从离线目录读取固定 v7 schema，codec 和稳定前缀校验使用所选源码；输出固定为 v7。

默认模式为 dry-run：源库连接只读，转换与约束校验在内存临时库完成。可先限定一个会话查看计划：

```bash
node scripts/migrate-session-sqlite-v7.mjs \
  --root "$HOME/.downcity" \
  --agent example-agent \
  --session example-session \
  --category chat \
  --partition sessions \
  --report ./session-v7-preflight.json
```

`--dry-run` 可显式指定。`--root` 默认是 `~/.downcity`；`--agent`、`--session`、`--category` 都是精确匹配。`--partition sessions` 只选择活动分区，`--partition archived-sessions` 只选择归档分区；省略时同时扫描两类分区。同一 Agent 的同名会话在选定范围内重复时阻塞，工具不会自行选择其中一份。未指定筛选时扫描所有受支持路径：`agents/<agent>/sessions/<category>/<session>/session.db` 及 `archived-sessions` 下的同形路径。隐藏目录及符号链接目录不参与扫描。没有匹配数据库时返回非零退出码，避免误把错误范围当作成功。

源库使用正常 SQLite 只读连接以读取已提交 WAL；不要把实时库当作 immutable 文件，也不要只复制主数据库文件来制作副本。运行中的 dry-run 只说明各库读取快照的状态，apply 会重新预检和核对指纹。

## 显式修复清单

已核验并获批的历史异常可通过 `--repair-manifest PATH` 指定，dry-run 与 apply 使用同一套严格检查。清单是权限为 `0600` 的普通 JSON 文件，格式为 `{ "format_version": 1, "databases": [...] }`。每个数据库条目只包含 `database_path`、`source_fingerprint`、`operations`：路径必须是相对数据根目录的完整受支持数据库路径，指纹必须来自未经修改的完整源快照。

```bash
node scripts/migrate-session-sqlite-v7.mjs \
  --dry-run \
  --root "$HOME/.downcity" \
  --repair-manifest ./session-v7-reviewed-repairs.json \
  --report ./session-v7-reviewed-preflight.json
```

清单由审阅者依据只读证据准备，工具不自动批准异常。仅支持以下精确操作：

- `renumber_parts`：绑定 `message_id`、消息完整行的 `row_sha256` 和完整有序 `parts`。每个 Part 包含 `part_id`、完整行的 `row_sha256`、`source_sequence`、`target_sequence`，目标按原相对顺序从 1 连续编号。`evidence` 包含旧一致性备份的 `backup_fingerprint` 及 `missing_interactions`；每个缺失位置记录 `source_sequence`、`legacy_part_id`、`legacy_row_sha256`、`tool_part_id`、从 0 开始的 `interaction_index`、`payload_sha256`。审阅时必须用旧备份证明缺失行是 Interaction，去除 Part 身份字段后的完整内容与当前同消息 Tool 中嵌套内容一致；执行时核对当前精确行和载荷哈希。
- `remove_media_delivery`：只包含 `kind`、`message_id`、`part_id`、Part 完整行的 `row_sha256`。只对已指定且包含字符串 `media_version` 的 file 移除 `media_delivery: "tool"`，记录被移除的字段和值。其他字段继续接受完整 codec 校验。
- `historical_inbox`：绑定 `message_id`、消息完整行的 `row_sha256`、完整有序 `parts`（每项仅 `part_id` 和完整行的 `row_sha256`），以及 `background_tag`（`delegation_result` 或 `task_result`）。只处理无 meta、无 fork 来源且含该 context 标记的可见 User 消息，保留原文顺序，生成历史 Inbox，不补造 actor、powers 或 callback。

每个操作还必须包含 `kind`。完整行哈希和源逻辑指纹使用工具库 `scripts/lib/session-v7-database.mjs` 导出的 `digest` 与 `snapshot_file` 计算；不要改写源快照或用修复后的内容生成源指纹。操作记录与哈希是精确审阅依据，不能据此推广修复范围。源库指纹变化必须重新审阅。

未知字段、重复数据库/操作/Part/证据、身份或指纹不符、未匹配条目都会阻塞。清单中的每个库必须处于本次选择范围；缩小筛选时须同时提供对应范围的获批清单。没有清单或未被精确指定的异常继续阻塞。清单和报告包含结构身份，须保存在私有位置，不纳入公开文档或版本库。

apply 使用同一清单时，在下方命令中追加 `--repair-manifest ./session-v7-reviewed-repairs.json`。修复仅作用于规划副本；原始一致性备份、源文件身份核对及事务锁内指纹校验始终依据原始源快照。报告及批次 manifest 的 `repairs` 记录修复依据、原身份/序号/字段值和映射，`repair_entry_sha256` 绑定清单条目；完整原始历史仍保存在强制备份中。

## 离线执行

执行前，先取得数据所有者对**精确范围**的确认，并完全退出可能写入这些库的 Desktop、CLI 和 Agent 进程。当前执行任务的 Agent 也可能持有目标库，应在独立终端执行。工具不会替你停止或启动服务，也不能证明所有写入进程已经退出。

以下命令会修改选中范围的数据库，只在完成上述准备后执行：

```bash
node scripts/migrate-session-sqlite-v7.mjs \
  --apply \
  --root "$HOME/.downcity" \
  --agent example-agent \
  --session example-session \
  --category chat \
  --partition sessions \
  --backup-dir ./session-v7-backups \
  --report ./session-v7-apply.json
```

`--apply` 必须同时提供 `--backup-dir`，不能跳过备份。每次创建独立批次目录；原始备份通过 SQLite 一致性备份生成，包含已提交 WAL，并校验完整逻辑指纹与文件 SHA-256。原始备份文件只读，工具不覆盖已有备份。另建工作副本完成试迁移与当前 codec 校验后，才获取源库写锁并核对源版本、内容和文件身份。

一次选择中只要预检有阻塞，就不会迁移任何源库。预检全部通过后，各库独立事务提交，整批不具备跨库原子性。锁冲突、源库变化或执行失败会停止后续库；已经提交的库保留结果，其他库明确列为未执行。未提供该库修复条目时，重复执行会完整校验已有 v7 库并跳过，不重复生成 Inbox。携带修复条目的 v7 库会以 `repairs_require_legacy_database` 阻塞；中断后先依据批次报告与实际库状态核对结果，从清单中移除已成功提交并验证的条目，再对剩余获批条目预检。保留原始清单与报告供审计；提交后验证失败的库需要单独审阅。

## 数据处理

历史内部输入，以及来源为 Session 或 runtime 的输入，转换为独立 Agent 消息中的 Inbox；人工来源且可见的输入保留 User 消息。来源对象、powers、callback、原 Message ID、Turn、消息顺序、时间及 fork 来源关联保留。历史缺少来源的可见输入保持其人工消息身份；明确后台结构与可见性矛盾时，只有精确获批的历史 Inbox 操作可以转换，否则阻塞。未知或不完整身份不会补造。

Inbox 内容仅支持有序 text、context、file。不支持的内容、附件字段、重复身份、Part 顺序缺口、streaming 消息、异常 schema，以及无法唯一归属同一消息内 Tool 的 Interaction 都会阻塞。工具不猜测工具或 Turn 引用，不静默丢弃内容。独立 Interaction 折叠到所属 Tool，迁移清单记录 Part 身份与嵌套位置映射。

附件原路径、URL 和媒体版本保持，文件不搬迁，不重新授予访问权限。缺失或已变化的附件仍按当前读取规则处理。稳定前缀按完整 Step 和终态边界计算，不越过未终态内容。

已知派生摘要表 `composer_adaptive_part_checkpoints` 与 `composer_sequence_summaries` 会清理，由后续真实输入重新累积；迁移不调用模型。原摘要保存在备份中，迁移后的首轮可能需要更多上下文和摘要成本。Session 配置、Workspace、模型绑定和已有执行身份保留；缺失的可选表创建为空表。

## 报告与退出码

控制台输出数量和完成状态；`--report` 保存逐库 JSON 计划、结果和映射。报告路径必须不存在，建议每次使用新文件名。apply 批次还会持续更新自己的 `report.json`，并保存 `original/`、`work/`、`manifests/`。报告不包含消息正文、callback/powers 载荷或摘要内容，但包含会话及 Part 标识，应作为私有文件保存。原始备份含完整历史数据，应妥善保护。

- `planned`：dry-run 的完整转换校验通过，尚未迁移。
- `validated_v7_skipped`：已有 v7 的结构、约束、完整性、codec 与稳定前缀校验通过。
- `blocked`：预检阻塞；`reason` 是固定诊断码，例如 `visible_unaccounted_background_input`、`non_contiguous_source_parts`、`duplicate_session_identity`。
- `not_applied_preflight_blocked`：本库预检通过，但同一选择中其他库阻塞，未执行。
- `migrated`：已提交且独立只读复核通过。
- `failed`、`not_applied_after_failure`：执行失败及其后未执行的库。
- `committed_pending_verification`、`committed_verification_failed`：提交已发生，复核未完成或失败，需要结合备份和实际库状态检查，不能视为已回滚。
- `unprocessed`、`backup_work_verified`：持久化报告中的中间状态；中断后先核对实际数据库版本及备份清单。

报告顶层 `repair_errors` 列出未消费的数据库条目（`unconsumed_repair_database`）；它同样阻塞整批 apply，已通过的库列为 `not_applied_preflight_blocked`。源指纹变化使用 `repair_source_fingerprint_mismatch`，其余身份、证据和清单格式问题也使用固定诊断码。

退出码 0 表示所选范围 dry-run 全部通过，或 apply 全部完成/验证跳过；任何阻塞、失败、锁冲突或空范围返回非零。遇到阻塞应审阅对应库的结构与来源证据，再明确处理方案；缩小范围时也要重新确认实际迁移范围。

## 恢复

恢复是单独的数据写入操作，需要另行确认并退出所有相关写入进程。先保护当前库，核对批次 `manifests/` 中的原始备份路径、版本、逻辑指纹和 SHA-256，再将一致性原始备份恢复到目标路径。必须正确处理目标的 WAL/SHM，避免残留日志与恢复文件混用；不要在服务仍持有连接时替换数据库文件。

工具不自动恢复，也不提供恢复命令。恢复到 v5/v6 后，只能由匹配该 schema 的运行时读取；v7 运行时仍会要求离线迁移。应先在临时目录演练恢复并校验 SQLite 完整性，确认后再决定实际恢复及后续启动操作。
