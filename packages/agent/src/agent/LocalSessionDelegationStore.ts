/**
 * Agent 私有委派存储：每条工作使用独立 JSON 快照及文件事务锁。
 * 依赖受控 FileSystem，独立 SDK 的内存存储与 City 的持久化存储使用同一协议。
 * 数据损坏明确失败；执行与投递更新读取最新记录，避免停止和完成互相覆盖。
 */
import type { FileSystem } from "@downcity/type";
import type { SessionDelegationRecord, SessionDelegationStore } from "@/types/agent/SessionDelegation.js";

/** 基于 Agent 私有文件能力的委派存储。 */
export class LocalSessionDelegationStore implements SessionDelegationStore {
  constructor(private readonly files: FileSystem) {}

  /** 读取单条快照；原子写入保证读取不会看到半条 JSON。 */
  async get(delegation_id: string): Promise<SessionDelegationRecord | undefined> {
    const path = this.record_path(delegation_id);
    if (!(await this.files.path_exists(path))) return undefined;
    const record = JSON.parse((await this.files.read_file(path)).toString("utf8")) as SessionDelegationRecord;
    if (record.delegation_id !== delegation_id || !record.caller?.session_id || !record.work_session_id) {
      throw new Error(`Invalid delegation record: ${delegation_id}`);
    }
    return record;
  }

  /** 同一工具调用只创建一条委派。 */
  async create(record: SessionDelegationRecord): Promise<SessionDelegationRecord> {
    return await this.transaction(record.delegation_id, async () => {
      const existing = await this.get(record.delegation_id);
      if (existing) return existing;
      await this.save(record);
      return record;
    });
  }

  /** 串行更新一条记录，保留其他调用已经提交的状态。 */
  async update(delegation_id: string, mutate: (record: SessionDelegationRecord) => SessionDelegationRecord): Promise<SessionDelegationRecord> {
    return await this.transaction(delegation_id, async () => {
      const record = await this.get(delegation_id);
      if (!record) throw new Error(`Delegation not found: ${delegation_id}`);
      const next = mutate(record);
      if (next.delegation_id !== delegation_id) throw new Error("Delegation identity cannot change");
      await this.save(next);
      return next;
    });
  }

  /** 返回待执行或待投递的记录；不把终态委派重新启动。 */
  async pending(): Promise<SessionDelegationRecord[]> {
    if (!(await this.files.path_exists("delegations"))) return [];
    const records: SessionDelegationRecord[] = [];
    for (const entry of await this.files.read_directory("delegations")) {
      if (!entry.is_file || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
      const record = await this.get(entry.name.slice(0, -5));
      if (record?.delivery_state === "pending") records.push(record);
    }
    return records;
  }

  /** 校验稳定标识后映射到 Agent 私有相对路径。 */
  private record_path(delegation_id: string): string {
    if (!/^[a-f0-9]{64}$/.test(delegation_id)) throw new Error("Invalid delegation id");
    return `delegations/${delegation_id}.json`;
  }

  /** 完整快照以原子替换方式提交。 */
  private async save(record: SessionDelegationRecord): Promise<void> {
    await this.files.write_file_atomically(this.record_path(record.delegation_id), JSON.stringify(record));
  }

  /** 文件锁由 FileSystem 管理，存储不持有 Session 或执行对象。 */
  private async transaction<T>(delegation_id: string, action: () => Promise<T>): Promise<T> {
    const path = this.record_path(delegation_id);
    await this.files.ensure_directory("delegations");
    return await this.files.with_file_lock(`${path}.lock`, action);
  }
}
