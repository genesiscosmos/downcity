/**
 * Env 数据存储。
 *
 * 基于 CityTableApi，不直接依赖 Drizzle。
 */

import { normalizeEnvKey } from "../../utils/helpers.js";
import type { CityTableApi } from "../../store/table-api.js";
import type { EnvEntry, EnvUpsertInput } from "./types.js";

export class EnvStore {
  constructor(private table: CityTableApi<EnvEntry>) {}

  async list(): Promise<EnvEntry[]> {
    return this.table.select();
  }

  async upsert(input: EnvUpsertInput): Promise<EnvEntry> {
    const key = normalizeEnvKey(input.key);
    const value = String(input.value ?? "");
    const rows = await this.table.select({ key } as Partial<EnvEntry>);

    if (rows.length > 0) {
      await this.table.update({
        where: { key } as Partial<EnvEntry>,
        values: { value, updated_at: new Date().toISOString() } as Partial<EnvEntry>,
      });
    } else {
      const now = new Date().toISOString();
      await this.table.insert({ key, value, source: "database", created_at: now, updated_at: now } as EnvEntry);
    }

    return { key, value, source: "database" };
  }

  /**
   * 原子确保 env key 存在，并返回数据库最终保存的值。
   *
   * 多个 Worker isolate 并发首次启动时，所有实例可能生成不同默认值。主键约束负责
   * 选出唯一胜者，失败方随后读取胜出值，避免覆盖已经建立的 Federation 身份。
   */
  async ensure(input: EnvUpsertInput): Promise<EnvEntry> {
    const key = normalizeEnvKey(input.key);
    const value = String(input.value ?? "");
    const now = new Date().toISOString();
    await this.table.insert_if_absent({
      key,
      value,
      source: "database",
      created_at: now,
      updated_at: now,
    } as EnvEntry);

    const rows = await this.table.select({ key } as Partial<EnvEntry>);
    const stored = rows[0];
    if (!stored) throw new Error(`Failed to initialize Federation env key: ${key}`);
    return { key, value: stored.value, source: "database" };
  }

  async remove(key: string): Promise<void> {
    await this.table.delete({ key: normalizeEnvKey(key) } as Partial<EnvEntry>);
  }
}
