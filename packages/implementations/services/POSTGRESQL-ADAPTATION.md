# Services PostgreSQL 适配交付

本次仅修改 `public/packages/implementations/services`。核心 Federation、数据库 Adapter、CLI 和私有 Worker 由并行工作负责。本次未访问线上或部署，也未执行生产数据迁移。

## 实现

- Accounts、Credits、Payment、Feedback 声明 `database_schemas.sqlite/postgresql`；Organizations 已有同样声明，继续使用。Usage 无独立服务表。
- PostgreSQL 表保持与 SQLite 相同的物理表名和业务字段；整数采用 bigint/number，认证日期采用 timestamptz/Date，认证邮箱验证采用 boolean。清理新模块的复制常量与空文档块。
- `shared/database-sql.ts` 为服务参数化 SQL 转换 PostgreSQL 编号占位符，保留引号内文本；数据库 Adapter 接收原生方言 SQL，不需要改接口。
- Accounts better-auth 按 schema_id 使用 pg/sqlite provider 和对应 Drizzle 表。直接认证 SQL 引用既有大小写列名，OAuth 用户写入使用 PostgreSQL boolean。
- Accounts prepare 显式建立 email、Session Token、Provider 身份唯一索引，以及 Session 用户、Account 用户、Verification identifier 查询索引，SQLite 与 PostgreSQL 均执行。约束冲突时失败，不删除或合并账号。
- Credits 用标准 ON CONFLICT 处理幂等插入；分配 CTE 在 PostgreSQL 使用 jsonb_to_recordset，SQLite 继续 json_each。PostgreSQL prepare 显式安装余额及业务枚举 CHECK；SQLite 保留原有负余额触发器。
- 历史额度检查改为派生表 WHERE 过滤聚合结果，并显式 GROUP BY primary_card.credits，修复 PostgreSQL HAVING 别名与聚合字段要求。
- PostgreSQL 流水增加 ledger_sequence bigserial，替代钱包历史查询对 SQLite rowid 的依赖；其他列表以业务 ID 作同时间排序键。准备阶段支持已有 PG 表补建该列。
- Payment Inbox 的直接查询使用方言参数入口；索引 DDL 可在两种数据库上执行。

## 本地验证结果

- `pnpm --dir public/packages/implementations/services typecheck`：通过。
- `pnpm --dir public/packages/implementations/services test`：37 项通过，0 失败，包含 SQLite、D1 模拟、认证、账务、支付 Provider、Organizations 与 Usage。
- `git -C public diff --check -- packages/implementations/services`：通过。
- 使用用户提供的临时本机 PostgreSQL 16；所有验证创建独立数据库，未修改 downcity_check 或 federation_all_check 的表。
- 复用现有 Accounts 8 项、Payment 1 项、Feedback 1 项到真实 PostgreSQL：10 项全部通过。覆盖注册、登录、Token、Google/WeChat 浏览器授权流程、支付订单与 webhook 幂等履约、反馈管理。只更换测试驱动，网络 Provider 使用现有模拟。
- 复用现有 Credits 两项完整流程到 PostgreSQL：2 项全部通过，覆盖主卡/限时卡、过期、活动卡数量、安全总额、幂等边界。测试内直接执行的 SQLite 参数与预期约束报错按 PG 方言调整；仓库未新增测试文件。
- PostgreSQL 专项并发检查：主卡 100 + 限时卡 50，两笔不同幂等键并发扣款 100，仅一笔成功，另一笔返回 insufficient credits；最终主卡 50、限时卡 0，无 pending 交易，无负余额。验证了锁前 allocation 在过时后，事务内条件写入及补偿仍保持正确。
- 直接 SQL 写负余额被 PG CHECK 拒绝；PG 目录确认 Accounts email/Session Token 唯一索引存在。
- 两个独立新 Federation 实例分别对同一隔离 PG 数据库执行 prepare_database + health：均通过，验证准备 DDL 可重复执行。核心要求 prepare_database 使用新实例，不能在已经初始化的同一个 Federation 实例重复调用。

## 迁移映射

以下列从 D1 integer epoch milliseconds 转为 PostgreSQL timestamptz；不要将毫秒整数直接当作 PostgreSQL 时间戳。转换可使用 `to_timestamp(epoch_ms / 1000.0)` 或等价 UTC Date 映射，保留毫秒精度。

| 表 | 列 |
| --- | --- |
| auth_users | createdAt、updatedAt |
| auth_sessions | expiresAt、createdAt、updatedAt |
| auth_accounts | accessTokenExpiresAt、refreshTokenExpiresAt、createdAt、updatedAt |
| auth_verifications | expiresAt、createdAt、updatedAt |

`auth_accounts.accessTokenExpiresAt/refreshTokenExpiresAt` 允许 NULL。`auth_users.emailVerified` 从 0/1 转 boolean。其余流程毫秒字段保持 bigint，不转换 timestamptz。

`service_credits_transaction_entries.ledger_sequence` 由 PG 自动生成。历史导入必须按原 D1/SQLite rowid 升序插入，且不显式绑定该列，以保持同毫秒流水先后顺序。若 PG 表已经导入但未保留同毫秒顺序，事后 ADD COLUMN 无法恢复原顺序，需要迁移任务依据原库重建顺序。保留所有历史业务列。

## 仍需关注的限制

- 当前 PostgreSQL Credits 原子写使用固定服务级 pg_advisory_xact_lock，串行化所有用户的账务写入；正确性已验证，但吞吐量受全局锁限制。这不是最终扩容方案。后续需将原子命令显式传入 user_id，按用户获取事务锁，并协调全局清理/维护与用户写入的锁顺序，再进行多用户并发和压力验证。
- atomic() 必须在同一个物理 PostgreSQL 事务连接内按顺序执行锁与领域命令；当前本机 Adapter 满足该约定。锁外读取可能过时，事务内条件更新负责拒绝不满足条件的扣款，失败补偿与 pending 清理已实测。
- 真实 PG 验证覆盖服务行为和模拟 Provider 的支付流程；未调用外部支付/OAuth 平台，也未验证 Supabase 网络连接、连接池配置、生产数据全表导入或生产吞吐。
- 本次 PG 字段映射与流水导入要求需由迁移任务接入；本次结果不代表生产数据已迁移。
- 临时 PG 测试数据库保留在本机实例，便于排查；原测试的 PG 副本位于系统临时目录，未纳入仓库。
