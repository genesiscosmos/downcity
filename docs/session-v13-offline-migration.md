<!-- Session v13 离线工具的实现边界与临时数据验收；用户命令位于 homepage 中英文离线迁移页。 -->

# Session v12→v13 离线转换

正式入口为 `node scripts/migrate-session-sqlite-v13.mjs`，提供 `--preflight`、`--apply`、`--verify`、`--status` 和 `--restore`。参数显式指定数据根及根外私有批次；apply/restore 必须声明 `--writers-stopped`。工具不管理服务进程，不默认访问用户数据根。

v13 的 SQL 结构来自当前 Agent 正式 DDL：`sessions.type`、`sessions.kind` 独立存列，`relations` 保存已有创建关系及保留事实，不重复 type/kind。数据库 `user_version`、`storage_metadata.format_version`、根 ready 标记均转换为 13。公开 Session、summary 和 info 使用顶层 `id/type/kind/parent`；离线存储记录、附件所属清单及跨对象引用继续使用 `session_id/agent_id`。

## 转换范围

- 正式 v12 将 `category` 转为 `type`，`origin.type` 转为 `kind`。`chat/agent` 映射为 `chat/main`，其他 kind 保留。
- `session-descriptor-v12` 过渡版按完整 DDL 摘要识别。`descriptor.kind` 拆到独立列，已有关系和附加创建事实写到 `relations`。逐条校验归档计划摘要、主会话指针和 v13 消息解码，保留归档计划、创建键和已转换的消息原字节。
- 已有 `parent_agent_id/parent_session_id/parent_session_category` 投影为 parent 及 parent_session_type；不从消息顺序推断新关系。
- origin 的额外业务字段完整保留在 relations 中。公开 normalizer 只投影其声明的字段；额外字段仍可从原始存储和备份审计。与新保留字段冲突的旧数据阻断，不能静默删除。
- 只改框架定义的 user message `meta.from.category` 和 input Part `meta.from.category`，转换为 type。正文、工具入参、工具输出、已保存模型视图和 ResultRef 字节不递归替换。
- 创建键和归档计划字段转换为 type/kind；先验证原归档计划摘要，再按新字段派生目标摘要。
- UUID、消息/Part 身份、稳定水位、配置、Composer 检查点、操作回执、退休身份及附件保持原事实。

`session-version-migration.mjs` 保持为批次安全框架：先取得根和 Agent 文件租约、备份全部源库，再转换和校验全部暂存库，最后逐库发布。目标通过正式 DDL、完整性、外键、逐消息 codec、主会话指针和全表内容摘要验证后才写 ready。源变化阻断 apply；后续业务写入或附件变化阻断 restore。中断使用原批次继续，备份不自动清理。

## 历史协议

`fixtures/session-v12/` 冻结已发布的 category/origin v12 协议，来源为 public commit `9a983f62a`，不是同版本的过渡 descriptor 结构。冻结范围包含 DDL、约束、归档结构、codec、actor、input、结果引用、披露及根门禁。v9–v11 fixture 的 actor/稳定前缀/结果协议依赖转向冻结版本，不改变其历史字段契约。

`migrate-session-sqlite-v12.mjs` 使用冻结 v12 作为目标，完成 v11→v12。所有历史迁移保持原输出版本，再显式运行 v12→v13。v13 工具同时接收冻结的正式 v12 和符合已登记 DDL 的过渡版 v12。

离线 bridge 直接加载源码，不依赖陈旧 bin。当前协议使用 SessionDescriptor 的新导出，历史协议加载冻结的 SessionOrigin。Node.js >=22.18，并需已安装仓库依赖。

## 单记录 transfer

当前 export/import 使用 schema 13，包 format 3、导入批次 format 3。manifest 和记录是独立存储协议，不采用公开 summary 的 id 字段改名。保持同 Agent、永久 UUID、冲突拒绝、附件先发布、事务及 receipt 确认重入的现有机制。

正式 import 拒绝历史包并要求显式 converter。`convert-session-package.mjs` 支持历史 v8/v9/v10/v11/v12 包，输出新路径的 schema13 包。历史包使用隔离记录/来源校验，目标使用 type/kind/relations；来源清单重新派生为 type。缺少终态 Tool 首次披露或跨记录 canonical 证据时继续阻断。原包、保存的结果快照和检查点不被覆盖。

## 日志与业务交付引用

数据库完成后、宿主恢复写入前，运行 `migrate-session-journals.mjs`，复用原日志工具的备份、暂存、发布、验证和恢复机制。

- Agent completion 与 delegation 从旧 origin 或嵌套 descriptor 转为顶层创建字段；已有执行身份、事件与投递确认保留。旧缺失执行身份委派仍按原安全规则阻断或停止，不能伪造可执行代次。
- `powers/task/tasks/*/task.toml` 及 `runs/*/run.json` 仅转换顶层 delivery_session.category→type；TOML 编码往返逐字段核验。
- `powers/memory/delivery/subscriptions/*.json` 仅转换 recipient.category→type；订阅 ID、请求键、待交付正文和确认状态保留。
- Memory processing/jobs、来源与摘录中的 category 是证据协议，保留原字段与字节，不纳入交付转换。

已有通知目标转换工具保持独立步骤，用户文档保留其命令与备份说明。

## 本次临时验收

全部数据位于系统私有临时目录，验证后清理；未读取或转换真实用户 root，未启动或重启服务，未提交代码、bump 或添加测试文件。

已通过：

- 冻结 v9/v10/v11/v12 loader，旧 category actor 继续接受。
- 真实 CLI v11→v12→v13 的 preflight/apply/verify 链，历史目标版本固定。
- v12→v13 只读预检源字节不变，完整迁移与验收，main/custom kind、parent、额外业务事实及 actor 转换。
- v13 export/import、同 operation 重入，直接历史包拒绝，v10/v11/v12 包显式转换为 v13。
- 备份恢复；预检后源变化拒绝发布；迁移后业务写入拒绝恢复。
- completion 顶层转换及幂等，额外业务事实保留。
- Task 定义和运行快照、Memory recipient 引用的实际 CLI preflight/apply/verify/restore；Memory 证据文件及 pending 字节不变。
- 修改文件的 JavaScript 语法检查和受限范围 diff 空白检查。

未执行全仓测试。现有 `migrate-session-sqlite-v12.test.mjs` 把 current runtime 硬编码期望为 12，其他部分历史测试也将 current 当作旧目标；本线程按不修改测试文件的约束保留，不能把它们视为 v13 验收。未完成 homepage MDX 构建，当前 homepage 无可直接解析的 `@mdx-js/mdx` 依赖；已检查文档字段、命令和中英文一致性。

## 确切文件

新增：

- `scripts/migrate-session-sqlite-v13.mjs`
- `scripts/lib/session-v13-migration.mjs`
- `scripts/lib/session-v12-runtime.mjs`
- `scripts/lib/session-delivery-conversion.mjs`
- `scripts/lib/session-transfer-historical-record.mjs`
- `scripts/lib/session-transfer-historical-sources.mjs`
- `scripts/fixtures/session-v12/{schema.sql,schema.mjs,constraints.mjs,archive-schema.mjs,codec.mjs,input-codec.mjs,prompt-actor.mjs,origin.mjs,view-validator.mjs,result-reference.mjs,result-disclosure.mjs,tool-result-projection.mjs,stable-prefix.mjs,identity.mjs,readiness.mjs}`
- `docs/session-v13-offline-migration.md`

修改：

- `scripts/{export-session.mjs,import-session.mjs,convert-session-package.mjs,migrate-session-sqlite-v12.mjs,migrate-session-journals.mjs}`
- `scripts/lib/{session-runtime.mjs,session-descriptor-conversion.mjs,session-descriptor-journal-conversion.mjs,session-transfer-protocol.mjs,session-transfer-record.mjs,session-transfer-sources.mjs,session-transfer-package.mjs,session-transfer-conversion.mjs}`
- `scripts/fixtures/session-v9/codec.mjs`
- `scripts/fixtures/session-v10/codec.mjs`
- `scripts/fixtures/session-v11/{codec.mjs,input-codec.mjs}`

删除被正式版本入口替代的 `scripts/migrate-session-descriptor.mjs`。

Homepage 位于 private 仓库，以下路径均同时修改 en 与 zh，保留文件中的并发变动：

- `apps/homepage/content/agent-sdk-docs/{en,zh}/sessions/{origin-and-types.mdx,info.mdx,session-management.mdx,metadata-and-storage.mdx,agent-chat.mdx,approvals.mdx,set-model.mdx}`
- `apps/homepage/content/agent-sdk-docs/{en,zh}/api-reference/{session-types.mdx,agent-class.mdx,remote-agent-class.mdx,sdk-surface.mdx,sdk-http-endpoints.mdx}`
- `apps/homepage/content/docs/{en,zh}/session-offline-migration.mdx`
