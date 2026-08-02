/**
 * Bureau 领域存储。
 *
 * Store 维护 Bureau 身份、唯一服务端入口和生命周期不变量。
 */

import { randomSecret } from "../../utils/helpers.js";
import type { CityTableApi } from "../../store/table-api.js";
import type {
  BureauCreateInput,
  BureauRecord,
  BureauState,
} from "../../types/Bureau.js";

/** Bureau 持久化与生命周期入口。 */
export class BureauStore {
  constructor(private readonly table: CityTableApi<BureauRecord>) {}

  /** 列出全部 Bureau。 */
  list(): Promise<BureauRecord[]> {
    return this.table.select();
  }

  /** 按稳定 ID 读取 Bureau。 */
  async get(bureau_id: string): Promise<BureauRecord | undefined> {
    return (await this.table.select({ bureau_id: read_bureau_id(bureau_id) }))[0];
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
    const bureau: BureauRecord = {
      bureau_id,
      name,
      server_url,
      state: "active",
      created_at: now,
      updated_at: now,
      archived_at: "",
    };
    await this.table.insert(bureau);
    return bureau;
  }

  /** 替换 Bureau 唯一绑定的服务端入口。 */
  async update_server_url(bureau_id: string, server_url: string): Promise<BureauRecord> {
    const current = await this.require(bureau_id);
    if (current.state === "archived") {
      throw new TypeError(`Archived Bureau cannot update server_url: ${current.bureau_id}`);
    }
    return await this.update(current, { server_url: read_server_url(server_url) });
  }

  /** 在 active 与 paused 之间切换，归档后不能恢复。 */
  async set_state(bureau_id: string, state: Extract<BureauState, "active" | "paused">): Promise<BureauRecord> {
    const current = await this.require(bureau_id);
    if (current.state === "archived") {
      throw new TypeError(`Archived Bureau cannot change state: ${current.bureau_id}`);
    }
    return await this.update(current, { state });
  }

  /** 把 Bureau 归档为终态。 */
  async archive(bureau_id: string): Promise<BureauRecord> {
    const current = await this.require(bureau_id);
    if (current.state === "archived") return current;
    const now = new Date().toISOString();
    return await this.update(current, {
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

  private async update(current: BureauRecord, values: Partial<BureauRecord>): Promise<BureauRecord> {
    const next: BureauRecord = {
      ...current,
      ...values,
      updated_at: values.updated_at ?? new Date().toISOString(),
    };
    await this.table.update({
      where: { bureau_id: current.bureau_id },
      values: next,
    });
    return next;
  }
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
