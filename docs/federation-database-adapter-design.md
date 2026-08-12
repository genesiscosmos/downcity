# Federation Database 继承式 Adapter 设计

> 状态：已实现
>
> 适用范围：`@downcity/federation`、Database Adapter、Federation Service、Node 与 Edge Runtime
>
> 核心决策：Federation SDK 导出抽象 `Database` 基类；每个数据库 Package 导出继承该基类的 `Database` 实现

## 1. 问题

当前 Federation 直接接收 Drizzle `db`：

```ts
const federation = new Federation({ db });
```

Federation 再从 `db.dialect` 和 `db.$client` 推断运行时，并在 Core 中处理：

- PostgreSQL 原生事务；
- better-sqlite3 显式事务和连接锁；
- Cloudflare D1 快照、批处理和冲突重试；
- Driver 之间不同的 DDL 执行方式；
- Service `_db`、`_client`、`_raw` 注入。

这让 Federation Core 同时承担了数据库协议和数据库实现。每增加一种数据库，都需要继续修改 Core，最终会扩大包体积、条件分支和测试矩阵。

以上为重构前状态。当前公开入口已经切换为 `new Federation({ database })`，具体 Driver 能力由独立 Adapter Package 持有。

根本问题不是 D1 代码放在哪个文件，而是 Federation 没有一个真正拥有数据库行为与生命周期的对象。

## 2. 产品意图与职责

### 2.1 Federation Database

Federation `Database` 回答：

> Federation 可以依赖哪些稳定的数据库行为，以及这些行为共享哪些生命周期和失败规则。

它拥有：

- 对外一致的数据库 API；
- active/disposed 生命周期；
- Table API 入口；
- 事务入口；
- DDL、参数化查询和原子命令入口；
- 统一错误和结果语义；
- 向 Service 投影的受限数据库能力。

### 2.2 具体 Database Adapter

具体 Adapter 回答：

> 上述行为如何在某一种 Drizzle Driver 和数据库运行时中落实。

它拥有：

- 物理连接或 Runtime binding；
- Drizzle 实例；
- 当前数据库的事务算法；
- DDL 执行方式；
- 参数绑定和结果归一化；
- 并发协调；
- Driver 资源释放。

### 2.3 Federation Service

Service 回答：

> 哪些领域数据需要读取，以及哪些变更必须原子提交。

Service 不负责：

- 判断 D1、SQLite 或 PostgreSQL；
- 调用 Driver Client；
- 选择事务算法；
- 管理数据库连接。

## 3. 设计目标

1. `@downcity/federation` 导出抽象 `Database` 基类。
2. 不创建额外的数据库协议 Package。
3. 每个 Adapter Package 都导出同名 `Database` 子类。
4. Federation 显式接收 `Database` 实例，不再接收裸 Drizzle db。
5. Drizzle 是 Downcity 数据库层明确选择的 Schema 与 Query 基础。
6. Federation Core 可以依赖 Drizzle 公共能力，但不能依赖任何具体 Driver。
7. D1、SQLite、PostgreSQL 的实现代码全部离开 Federation Core。
8. `context.transaction()` 在所有 Adapter 上保持一致。
9. Service 不再访问 `_db`、`_client` 或 `_raw`。
10. 新增同类数据库 Runtime 时，通过增加子类完成，不给 Federation 增加数据库分支。

## 4. 非目标

本次不做：

- 自研 ORM；
- 替换 Drizzle Schema；
- 支持非关系型数据库；
- 让一个 Federation 同时使用多个主数据库；
- 保留 `new Federation({ db })` 的兼容入口；
- 用一个万能 Adapter Package 打包所有数据库 Driver。

## 5. Drizzle 的定位

Drizzle 是数据库层的基础依赖，但不是完整的 Federation Database。

```text
Drizzle
  = Schema 定义 + Query Builder + Driver ORM

Federation Database 基类
  = 生命周期 + 统一行为 + Service 能力边界

Database 子类
  = Drizzle Driver + 事务 + DDL + 并发 + 连接
```

### 5.1 为什么不能继续直接传 Drizzle db

裸 Drizzle db 没有完整表达：

- 谁拥有和关闭连接；
- D1 如何模拟等价事务；
- SQLite 如何协调同一连接；
- DDL 应使用 `exec()`、prepared statement 还是 `unsafe()`；
- Service 可以看到哪些数据库能力；
- 关闭后是否仍允许调用。

因此 Federation 接收的必须是 Federation `Database`，而不是某个 Drizzle Driver 的返回值。

### 5.2 Federation 可以知道什么

Federation 可以知道：

- Drizzle Table Schema；
- Drizzle select/insert/update/delete 公共 Query 能力；
- Adapter 提供了一个只读 Drizzle 集成句柄。

Federation 不可以知道：

- `D1Database`；
- better-sqlite3 `Database`；
- postgres-js `Sql`；
- `$client.prepare()`、`batch()`、`unsafe()`；
- 具体 Driver 错误码分支。

### 5.3 Service 如何使用 Drizzle

普通 Service 不直接使用 Drizzle：

```ts
context.table("memberships");
context.transaction(...);
```

Accounts 的 better-auth Drizzle Adapter 是明确的第三方集成需求。Federation 通过受限的 Service Database Context 提供只读 `drizzle`，但不暴露 Driver Client。

## 6. Package 结构

### 6.1 `@downcity/federation`

包含：

- 抽象 `Database` 基类；
- `CityTableApi` 与公共 Drizzle Table API；
- Database 方法输入、输出和错误类型；
- Federation 数据库编排；
- Service Database Context。

不包含：

- D1、better-sqlite3、postgres-js 依赖；
- 具体事务实现；
- Driver Client 类型；
- 数据库运行时推断；
- D1 快照守卫。

### 6.2 `@downcity/database-d1`

导出：

```ts
export class Database extends CityDatabase {}
```

拥有 D1 binding、Drizzle D1、快照校验、原子 `batch()` 和冲突重试。

### 6.3 `@downcity/database-sqlite`

导出：

```ts
export class Database extends CityDatabase {}
```

拥有 better-sqlite3 Connection、Drizzle SQLite、WAL、连接锁和显式事务。

### 6.4 `@downcity/database-postgresql`

导出：

```ts
export class Database extends CityDatabase {}
```

拥有 postgres-js Client、Drizzle PostgreSQL、原生事务和连接关闭。

### 6.5 依赖方向

```text
database-d1 ──────────┐
database-sqlite ──────┼──> @downcity/federation
database-postgresql ──┘

@downcity/services ──────> @downcity/federation
```

Federation 不依赖任何具体 Adapter。

## 7. 公开使用方式

所有 Adapter 都导出 `Database`，由 Package 名表达数据库类型。

### 7.1 PostgreSQL

```ts
import { Federation } from "@downcity/federation";
import { Database } from "@downcity/database-postgresql";

const database = new Database({
  url: process.env.DATABASE_URL!,
});

const federation = new Federation({ database });
```

### 7.2 SQLite

```ts
import { Federation } from "@downcity/federation";
import { Database } from "@downcity/database-sqlite";

const database = new Database({
  filename: "./federation.sqlite",
});

const federation = new Federation({ database });
```

测试使用内存数据库：

```ts
const database = new Database({ filename: ":memory:" });
```

### 7.3 Cloudflare D1

```ts
import { Federation } from "@downcity/federation";
import { Database } from "@downcity/database-d1";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const database = new Database({ binding: env.DB });
    const federation = new Federation({ database });
    return await federation.fetch(request);
  },
};
```

### 7.4 Federation 构造参数

```ts
interface FederationOptions {
  /** Federation 唯一主数据库。 */
  database: Database;

  /** Federation 默认对象存储。 */
  storage?: FederationStorage;
}
```

删除：

```ts
new Federation({ db });
new Federation({ db, dialect, raw });
```

## 8. Federation `Database` 基类

基类使用 Template Method：公开方法统一维护生命周期和不变量，子类只实现受保护的运行时 Hook。

```ts
export abstract class Database<
  TDrizzle extends FederationDrizzleDatabase = FederationDrizzleDatabase,
> {
  /** Service Schema 标识。 */
  readonly schema_id: string;

  /** 当前 Adapter 的 Drizzle 实例。 */
  protected readonly drizzle: TDrizzle;

  private disposed = false;

  protected constructor(input: {
    schema_id: string;
    drizzle: TDrizzle;
  }) {
    this.schema_id = input.schema_id;
    this.drizzle = input.drizzle;
  }

  /** 创建普通 Table API。 */
  table<TRow extends Record<string, unknown>>(
    schema: FederationTableSchema,
  ): CityTableApi<TRow> {
    this.assert_active();
    return this.on_table<TRow>(schema);
  }

  /** 幂等创建物理表。 */
  async ensure_table(schema: FederationTableSchema): Promise<void> {
    this.assert_active();
    await this.on_ensure_table(schema);
  }

  /** 执行方言 DDL。 */
  async execute_ddl(statement: string): Promise<void> {
    this.assert_active();
    await this.on_execute_ddl(statement);
  }

  /** 执行参数化查询。 */
  async query<TRow extends Record<string, unknown>>(
    statement: DatabaseStatement,
  ): Promise<DatabaseQueryResult<TRow>> {
    this.assert_active();
    return await this.on_query<TRow>(statement);
  }

  /** 原子执行预构造命令。 */
  async atomic(
    statements: DatabaseStatement[],
  ): Promise<DatabaseMutationResult[]> {
    this.assert_active();
    return await this.on_atomic(statements);
  }

  /** 执行跨表事务。 */
  async transaction<TResult>(
    handler: (transaction: DatabaseTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    this.assert_active();
    return await this.on_transaction(handler);
  }

  /** 创建给 Service 使用的受限数据库投影。 */
  service_context(): ServiceDatabaseContext {
    this.assert_active();
    return this.create_service_context();
  }

  /** 幂等释放资源。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.on_dispose();
  }

  protected abstract on_table<TRow extends Record<string, unknown>>(
    schema: FederationTableSchema,
  ): CityTableApi<TRow>;

  protected abstract on_ensure_table(
    schema: FederationTableSchema,
  ): Promise<void>;

  protected abstract on_execute_ddl(statement: string): Promise<void>;

  protected abstract on_query<TRow extends Record<string, unknown>>(
    statement: DatabaseStatement,
  ): Promise<DatabaseQueryResult<TRow>>;

  protected abstract on_atomic(
    statements: DatabaseStatement[],
  ): Promise<DatabaseMutationResult[]>;

  protected abstract on_transaction<TResult>(
    handler: (transaction: DatabaseTransaction) => Promise<TResult>,
  ): Promise<TResult>;

  protected abstract create_service_context(): ServiceDatabaseContext;

  protected abstract on_dispose(): Promise<void>;
}
```

示例省略了错误类和内部辅助函数；正式代码中的类型放在 `types/database/`，所有字段提供中文文档注释。

### 8.1 基类负责什么

- API 形态；
- 生命周期检查；
- dispose 幂等；
- 输入归一化；
- Service 能力投影；
- 公共错误语义。

### 8.2 子类负责什么

- 创建和拥有 Driver；
- 创建 Drizzle 实例；
- Table API 的实际执行；
- 事务策略；
- DDL、query、atomic；
- Driver 错误归一化；
- 资源释放。

### 8.3 基类禁止什么

基类中不能出现：

```ts
if (this.schema_id === "sqlite") { ... }
if (client.batch) { ... }
if (client.unsafe) { ... }
```

任何数据库能力判断都表示职责放错了位置，应由子类直接实现对应 Hook。

## 9. 子类示意

PostgreSQL Package 内部使用别名避免类名冲突：

```ts
import { Database as FederationDatabase } from "@downcity/federation";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

export class Database extends FederationDatabase {
  private readonly client;

  constructor(options: DatabaseOptions) {
    const client = postgres(options.url);
    const drizzle_database = drizzle(client);
    super({
      schema_id: "postgresql",
      drizzle: drizzle_database,
    });
    this.client = client;
  }

  protected async on_transaction<TResult>(handler): Promise<TResult> {
    return await this.drizzle.transaction(async (transaction) => {
      return await handler(this.create_transaction(transaction));
    });
  }

  protected async on_dispose(): Promise<void> {
    await this.client.end();
  }
}
```

用户只看到当前 Package 导出的 `Database`，不会看到内部的 `CityDatabase` 别名。

## 10. Table API

`CityTableApi` 保持统一：

```ts
interface CityTableApi<TRow> {
  readonly name: string;
  readonly schema: FederationTableSchema;

  select(where?: Partial<TRow>): Promise<TRow[]>;
  insert(values: Partial<TRow> | Partial<TRow>[]): Promise<void>;
  insert_if_absent(value: Partial<TRow>): Promise<void>;
  update(input: {
    where: Partial<TRow>;
    values: Partial<TRow>;
  }): Promise<number>;
  delete(where: Partial<TRow>): Promise<number>;
}
```

Federation 可以保留基于 Drizzle 公共 Query Builder 的 `DrizzleTableApi`，供子类组合使用。

具体差异仍由子类负责：

- PostgreSQL：普通 Drizzle Table API；
- SQLite：带连接协调器的 Drizzle Table API；
- D1 普通操作：Drizzle D1 Table API；
- D1 事务操作：带快照和写缓冲的 Transaction Table API。

`FederationTableSchema` 是 Drizzle Table 的公共类型，不包含具体 Driver Client。

## 11. Service Database Context

不能把完整 `Database` 交给 Service，否则 Service 可以关闭 Federation 数据库或绕过逻辑表边界。

Service 只得到受限投影：

```ts
interface ServiceDatabaseContext {
  /** 当前 Service 使用的 Schema 标识。 */
  readonly schema_id: string;

  /** better-auth 等明确 ORM 集成使用的只读 Drizzle 实例。 */
  readonly drizzle: FederationDrizzleDatabase;

  /** 执行单条参数化查询。 */
  query<TRow extends Record<string, unknown>>(
    statement: DatabaseStatement,
  ): Promise<DatabaseQueryResult<TRow>>;

  /** 原子执行预先构造的命令。 */
  atomic(
    statements: DatabaseStatement[],
  ): Promise<DatabaseMutationResult[]>;
}
```

它不提供：

- `dispose()`；
- Driver Client；
- D1 binding；
- postgres-js Client；
- better-sqlite3 Connection；
- 任意物理表访问入口。

`ServiceInstallContext`：

```ts
interface ServiceInstallContext {
  table<TRow>(name: string): CityTableApi<TRow>;

  transaction<TResult>(
    handler: (
      transaction: ServiceTransactionContext,
    ) => Promise<TResult>,
  ): Promise<TResult>;

  readonly database: ServiceDatabaseContext;
}
```

## 12. Service 使用规则

### 12.1 Organizations

只使用高级接口：

```ts
await context.transaction(async (transaction) => {
  await transaction.table("organizations").insert(organization);
  await transaction.table("memberships").insert(membership);
});
```

Organizations 不访问 `context.database`，也不判断 `schema_id`。

### 12.2 Accounts

当前 Accounts 直接访问 `_db` 和 `_raw.prepare()`。

迁移后：

- better-auth 使用 `context.database.drizzle`；
- Profile 和后台查询使用 `context.database.query()`；
- 删除 `readDrizzleDb()` 和 `rawPrepare()`；
- 不保存 Driver Client。

### 12.3 Credits

当前 Credits `raw.ts` 自己判断 D1 和 better-sqlite3。

迁移后：

- 账务 SQL 仍由 Credits Repository 拥有；
- 单条读取使用 `context.database.query()`；
- 原子账务命令使用 `context.database.atomic()`；
- 删除 D1/better-sqlite3 Client 判断；
- Credits 不再拥有数据库执行策略。

`query()` 和 `atomic()` 只适用于明确声明当前 `schema_id` 的底层 Service。普通 Service 优先使用 Table API。

## 13. Schema 选择

Adapter 通过开放的 `schema_id` 选择 Service Schema：

```ts
const database_schemas = {
  sqlite: {
    tables: sqlite_tables,
    ddl: sqlite_ddl,
  },
  postgresql: {
    tables: postgresql_tables,
    ddl: postgresql_ddl,
  },
};
```

初始化流程：

```text
database.schema_id
  → Federation 选择 Service Schema
  → database.execute_ddl(service ddl)
  → database.ensure_table(table schema)
  → database.table(table schema)
  → Service install
```

`schema_id` 使用字符串，不在 Federation 中维护封闭联合类型。未来 MySQL Adapter 可以使用 `mysql`，只有需要支持 MySQL 的 Service 才增加 `mysql` Schema。

## 14. 事务统一语义

所有 `Database` 子类必须保证：

1. handler 成功且提交成功后，全部写入同时可见；
2. handler 抛错时，不保留事务写入；
3. 任意写命令失败时，整组事务回滚；
4. 并发不能破坏唯一约束和领域状态机；
5. update/delete 返回可靠 mutation count；
6. 事务内后续读取可以看到当前事务自己的写入；
7. handler 可能因乐观冲突重跑，不能包含不可回滚的外部副作用。

### 14.1 PostgreSQL

子类使用 Drizzle 原生事务：

```text
on_transaction
  → drizzle.transaction
  → transaction-bound Table API
  → COMMIT / ROLLBACK
```

### 14.2 SQLite

子类使用同一 better-sqlite3 Connection：

```text
connection coordinator
  → BEGIN IMMEDIATE
  → handler
  → COMMIT / ROLLBACK
```

普通操作和事务操作共享 Adapter 内部协调器。

### 14.3 D1

D1 不提供跨 JavaScript 检查点的交互式事务。子类实现乐观 Unit of Work：

```text
读取数据并记录快照
  → 在本地事务视图中应用写命令
  → 生成快照守卫
  → batch(守卫 + 写命令)
  → 冲突则重跑 handler
```

D1 子类负责：

- 快照守卫表；
- SQL 编译与参数绑定；
- 事务内写入视图；
- read-your-writes；
- `batch()` 原子提交；
- 冲突识别和有限重试；
- D1 错误到 Federation 错误的转换。

Federation 基类和 Organizations 都不包含 D1 分支。

## 15. `atomic()` 与 `transaction()` 的区别

`transaction()`：

- handler 中需要根据读取结果执行领域分支；
- 对 Service 暴露逻辑 Table API；
- D1 可能重跑 handler。

`atomic()`：

- 调用前已经生成完整 SQL 命令列表；
- 不在执行期间运行 JavaScript 分支；
- 适合 Credits 已构造完成的账务命令；
- 每个 Adapter 保证整组提交或整组回滚。

两者不能相互伪装，也不增加 `atomic_command` 到 Organizations API。

## 16. 生命周期

Database 是数据库资源拥有者：

```text
应用创建 Database
  → Database 创建连接与 Drizzle
  → 传给 Federation
  → Federation 使用 Database
  → Federation.dispose()
  → Database.dispose()
```

具体规则：

- PostgreSQL 子类关闭 postgres-js Client；
- SQLite 子类关闭 better-sqlite3 Connection；
- D1 binding 由 Worker Runtime 拥有，子类只清理内部缓存；
- `dispose()` 幂等；
- dispose 后所有公开数据库操作失败；
- Federation 初始化失败时也调用 dispose；
- Service 永远不能调用 dispose。

## 17. 错误模型

Federation 定义稳定错误类：

| 错误 | 含义 |
| --- | --- |
| `DatabaseClosedError` | Database 已释放 |
| `DatabaseSchemaError` | Service 没有当前 `schema_id` 的 Schema |
| `DatabaseTransactionConflictError` | 乐观事务超过最大重试次数 |
| `DatabaseCapabilityError` | 子类没有正确实现要求的能力 |

Driver 原始错误放在 `cause`。Federation 和 Service 不根据 Driver Client 类型或文案判断数据库类型。

领域冲突仍由 Service 转换，例如：

- `ORGANIZATION_LIMIT_REACHED`；
- `JOIN_REQUEST_NOT_FOUND`；
- Credits 幂等冲突。

## 18. 测试

### 18.1 Database 基类测试

- 公开方法在 dispose 后全部拒绝；
- dispose 幂等；
- Service Context 不暴露 dispose 和 Driver；
- 子类 Hook 错误保留 cause；
- Schema ID 正确投影。

### 18.2 公共子类契约测试

同一套测试运行在三个 Adapter：

- DDL 与 CRUD；
- `insert_if_absent()`；
- mutation count；
- 多表事务提交；
- handler 抛错回滚；
- 中间命令失败回滚；
- compare-and-set 并发；
- read-your-writes；
- `atomic()` 完整回滚；
- dispose 与连接释放。

### 18.3 D1 专项测试

- 使用真实 Miniflare D1；
- 快照冲突重试；
- Owner 配额并发；
- Join Request 并发审批；
- batch 失败无部分写入。

### 18.4 SQLite 专项测试

- active transaction 期间普通操作等待；
- handler 跨 Promise 检查点保持连接独占；
- 文件数据库 WAL 并发。

### 18.5 PostgreSQL 专项测试

- 真实 PostgreSQL；
- 原生回滚；
- 唯一约束并发；
- Client 关闭。

## 19. 目录结构

```text
packages/
  city/
    src/
      database/
        Database.ts
        DrizzleTableApi.ts
      types/database/
        DatabaseOptions.ts
        DatabaseStatement.ts
        DatabaseResult.ts
        DatabaseTransaction.ts
        DatabaseError.ts

  database-d1/
    src/
      Database.ts
      D1Transaction.ts
      D1TransactionTableApi.ts
      types/
    test/

  database-sqlite/
    src/
      Database.ts
      SQLiteCoordinator.ts
      SQLiteTransaction.ts
      types/
    test/

  database-postgresql/
    src/
      Database.ts
      PostgreSQLTransaction.ts
      types/
    test/
```

基类只维护公共行为。任何具体数据库实现达到模块体积限制前必须在 Adapter Package 内拆分。

## 20. 迁移步骤

### 阶段一：建立基类

1. Federation 新增抽象 `Database`；
2. 建立受保护 Hook 和公共类型；
3. `FederationOptions` 改为 `{ database }`；
4. Federation 初始化只调用 Database 公共方法。

### 阶段二：建立三个子类

1. D1 逻辑迁入 `@downcity/database-d1`；
2. SQLite 事务和锁迁入 `@downcity/database-sqlite`；
3. PostgreSQL 事务迁入 `@downcity/database-postgresql`；
4. 三个 Package 都只导出本包的 `Database` 和必要 Options 类型。

### 阶段三：清理 Service 泄漏

1. 删除 Service `_db`、`_client`、`_raw`、`_database_dialect`；
2. Accounts 使用 Service Database Context；
3. Credits 使用 `query()` 和 `atomic()`；
4. Organizations 保持 `context.transaction()`。

### 阶段四：迁移调用方

1. Node 模板安装 SQLite Adapter；
2. Edge 模板安装 D1 Adapter；
3. 增加 PostgreSQL 示例；
4. CLI 生成模板同步更新；
5. 测试、示例和文档从 `{ db }` 改为 `{ database }`。

### 阶段五：删除旧实现

Federation 删除：

- D1 transaction；
- 数据库事务分派；
- `DbClient`；
- `executeDDL()` Driver 判断；
- 方言自动推断；
- `$client` 提取；
- Runtime 中重复的 database/client/raw 状态。

## 21. 发布与验证

1. 三个 Adapter 契约测试通过；
2. Organizations 在 D1、SQLite、PostgreSQL 运行相同测试；
3. Accounts 和 Credits 回归通过；
4. Federation、Services、CLI、Node Template、Edge Template typecheck；
5. Homepage 构建通过；
6. 执行多 Package patch build；
7. 验证 Edge Worker D1 和 Local Node SQLite；
8. 验证 PostgreSQL Federation 初始化、事务和关闭。

## 22. 最终决策

| 决策 | 结果 |
| --- | --- |
| 核心抽象 | Federation `Database` 抽象基类 |
| Adapter 实现方式 | 类继承 |
| 独立协议 Package | 不创建 |
| ORM | 明确使用 Drizzle |
| Federation 输入 | `new Federation({ database })` |
| Adapter 导出名称 | 每个 Package 都导出 `Database` |
| 数据库推断 | 删除 |
| Driver Client 暴露 | 不暴露 |
| Service 底层能力 | 受限 `drizzle`、`query()`、`atomic()` |
| Organizations | 只使用 `context.transaction()` |
| D1 实现位置 | `@downcity/database-d1` |
| SQLite 实现位置 | `@downcity/database-sqlite` |
| PostgreSQL 实现位置 | `@downcity/database-postgresql` |
