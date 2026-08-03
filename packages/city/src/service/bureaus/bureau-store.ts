/**
 * Bureau 领域存储。
 *
 * Store 维护 Bureau 身份、唯一 Server 配置和生命周期不变量。创建操作通过
 * 跨表事务保证一对一关系完整，读取操作统一返回组合后的领域记录。
 */

import { randomSecret } from "../../utils/helpers.js";
import type { CityTableApi } from "../../store/table-api.js";
import type { Database } from "../../database/Database.js";
import type { FederationTableSchema } from "../../types/database/Database.js";
import type {
  BureauCreateInput,
  BureauIdentityRecord,
  BureauRecord,
  BureauServerRecord,
  BureauState,
} from "../../types/Bureau.js";

/** Bureau 持久化与生命周期入口。 */
export class BureauStore {
  private readonly database: Database;
  private readonly bureau_schema: FederationTableSchema;
  private readonly server_schema: FederationTableSchema;
  private readonly bureau_table: CityTableApi<BureauIdentityRecord>;
  private readonly server_table: CityTableApi<BureauServerRecord>;

  constructor(input: {
    /** Federation 主数据库，用于执行 Bureau 与 Server 跨表事务。 */
    database: Database;
    /** Bureau 身份物理表定义。 */
    bureau_schema: FederationTableSchema;
    /** Bureau Server 物理表定义。 */
    server_schema: FederationTableSchema;
    /** Bureau 身份表操作入口。 */
    bureau_table: CityTableApi<BureauIdentityRecord>;
    /** Bureau Server 表操作入口。 */
    server_table: CityTableApi<BureauServerRecord>;
  }) {
    this.database = input.database;
    this.bureau_schema = input.bureau_schema;
    this.server_schema = input.server_schema;
    this.bureau_table = input.bureau_table;
    this.server_table = input.server_table;
  }

  /** 列出全部 Bureau。 */
  async list(): Promise<BureauRecord[]> {
    const identities = await this.bureau_table.select();
    const servers = await this.server_table.select();
    const servers_by_bureau = new Map(servers.map((server) => [server.bureau_id, server]));
    return identities.map((identity) => compose_bureau(identity, servers_by_bureau.get(identity.bureau_id)));
  }

  /** 按稳定 ID 读取 Bureau。 */
  async get(bureau_id: string): Promise<BureauRecord | undefined> {
    const id = read_bureau_id(bureau_id);
    const identity = (await this.bureau_table.select({ bureau_id: id }))[0];
    if (!identity) return undefined;
    const server = (await this.server_table.select({ bureau_id: id }))[0];
    return compose_bureau(identity, server);
  }

  /** 创建 active Bureau。 */
  async create(input: BureauCreateInput): Promise<BureauRecord> {
    const name = read_required_text(input.name, "name");
    const server_url = read_server_url(input.server_url);
    const bureau_id = input.bureau_id
      ? read_bureau_id(input.bureau_id)
      : `bureau_${randomSecret(12)}`;
    if (await this.get(bureau_id)) {
      throw new TypeError(`Bureau already exists: ${bureau_id}`);
    }
    const now = new Date().toISOString();
    const identity: BureauIdentityRecord = {
      bureau_id,
      name,
      state: "active",
      created_at: now,
      updated_at: now,
      archived_at: "",
    };
    const server: BureauServerRecord = {
      bureau_id,
      server_url,
      created_at: now,
      updated_at: now,
    };
    await this.database.transaction(async (transaction) => {
      await transaction.table<BureauIdentityRecord>(this.bureau_schema).insert(identity);
      await transaction.table<BureauServerRecord>(this.server_schema).insert(server);
    });
    return compose_bureau(identity, server);
  }

  /** 替换 Bureau 唯一绑定的服务端入口。 */
  async update_server(bureau_id: string, server_url: string): Promise<BureauRecord> {
    const current = await this.require(bureau_id);
    if (current.state === "archived") {
      throw new TypeError(`Archived Bureau cannot update server_url: ${current.bureau_id}`);
    }
    const next_server: BureauServerRecord = {
      ...current.server,
      server_url: read_server_url(server_url),
      updated_at: new Date().toISOString(),
    };
    await this.server_table.update({
      where: { bureau_id: current.bureau_id },
      values: next_server,
    });
    return { ...current, server: next_server };
  }

  /** 在 active 与 paused 之间切换，归档后不能恢复。 */
  async set_state(bureau_id: string, state: Extract<BureauState, "active" | "paused">): Promise<BureauRecord> {
    const current = await this.require(bureau_id);
    if (current.state === "archived") {
      throw new TypeError(`Archived Bureau cannot change state: ${current.bureau_id}`);
    }
    return await this.update_identity(current, { state });
  }

  /** 把 Bureau 归档为终态。 */
  async archive(bureau_id: string): Promise<BureauRecord> {
    const current = await this.require(bureau_id);
    if (current.state === "archived") return current;
    const now = new Date().toISOString();
    return await this.update_identity(current, {
      state: "archived",
      archived_at: now,
      updated_at: now,
    });
  }

  /** 读取 Bureau，不存在时返回明确领域错误。 */
  async require(bureau_id: string): Promise<BureauRecord> {
    const id = read_bureau_id(bureau_id);
    const bureau = await this.get(id);
    if (!bureau) throw new TypeError(`Unknown Bureau: ${id}`);
    return bureau;
  }

  private async update_identity(
    current: BureauRecord,
    values: Partial<BureauIdentityRecord>,
  ): Promise<BureauRecord> {
    const next_identity: BureauIdentityRecord = {
      bureau_id: current.bureau_id,
      name: current.name,
      state: current.state,
      created_at: current.created_at,
      archived_at: current.archived_at,
      ...values,
      updated_at: values.updated_at ?? new Date().toISOString(),
    };
    await this.bureau_table.update({
      where: { bureau_id: current.bureau_id },
      values: next_identity,
    });
    return { ...next_identity, server: current.server };
  }
}

/** 把分表存储记录组合为完整 Bureau 领域对象。 */
function compose_bureau(
  identity: BureauIdentityRecord,
  server: BureauServerRecord | undefined,
): BureauRecord {
  if (!server) {
    throw new Error(`Bureau Server record is missing: ${identity.bureau_id}`);
  }
  return { ...identity, server };
}

/** 校验 Bureau ID。 */
export function read_bureau_id(value: unknown): string {
  const bureau_id = read_required_text(value, "bureau_id");
  if (!/^bureau_[A-Za-z0-9_-]+$/u.test(bureau_id)) {
    throw new TypeError("bureau_id must use the bureau_<id> format");
  }
  return bureau_id;
}

/** 规范化并验证 Bureau 服务端 HTTP(S) 入口。 */
export function read_server_url(value: unknown): string {
  const input = read_required_text(value, "server_url").replace(/\/+$/u, "");
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("server_url must use http or https");
  }
  if (url.username || url.password) {
    throw new TypeError("server_url must not contain credentials");
  }
  return input;
}

function read_required_text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} is required`);
  }
  return value.trim();
}
