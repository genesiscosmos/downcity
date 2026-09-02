/**
 * LocalGroupDispatchSessionDataStore：Group Dispatch Session 的追加式 Turn 日志。
 *
 * 每次状态迁移都追加完整快照；读取时按 dispatch_id 选择最后一条记录，因此中断前
 * 已提交的状态不会被覆盖，文件尾部的非完整写入也可以安全修复。
 */

import path from "node:path";
import type { FileSystem } from "@downcity/workspace";
import type {
  GroupDispatchSessionDataStore,
  GroupDispatchTurnRecord,
  GroupDispatchTurnStatus,
} from "@/types/group/GroupDispatchSession.js";

const dispatch_turn_statuses = new Set<GroupDispatchTurnStatus>([
  "queued",
  "running",
  "completed",
  "failed",
  "stopped",
]);

/** 基于 GroupSession 私有目录的 Dispatch Session Store。 */
export class LocalGroupDispatchSessionDataStore implements GroupDispatchSessionDataStore {
  private readonly files: FileSystem;
  private readonly dispatch_root_path: string;
  private readonly turns_file_path: string;
  private readonly transaction_lock_path: string;

  constructor(options: {
    /** 当前 Group StorageScope 文件能力。 */
    readonly files: FileSystem;
    /** 当前 GroupSession 的私有存储根目录。 */
    readonly session_root_path: string;
  }) {
    this.files = options.files;
    this.dispatch_root_path = path.join(options.session_root_path, "dispatch");
    this.turns_file_path = path.join(this.dispatch_root_path, "turns.jsonl");
    this.transaction_lock_path = path.join(this.dispatch_root_path, ".lock");
  }

  /** 读取每个调度 Turn 最后一次成功提交的状态。 */
  async list_turns(): Promise<GroupDispatchTurnRecord[]> {
    if (!(await this.files.path_exists(this.turns_file_path))) return [];
    await this.files.ensure_directory(this.dispatch_root_path);
    return await this.files.with_file_lock(this.transaction_lock_path, async () => {
      const records = await this.read_records(true);
      const turns_by_id = new Map<string, GroupDispatchTurnRecord>();
      for (const record of records) {
        turns_by_id.delete(record.dispatch_id);
        turns_by_id.set(record.dispatch_id, record);
      }
      return [...turns_by_id.values()];
    });
  }

  /** 追加一个完整状态快照，状态提交与其它调度 Turn 串行。 */
  async append_turn(turn: GroupDispatchTurnRecord): Promise<void> {
    assert_dispatch_turn(turn);
    await this.files.ensure_directory(this.dispatch_root_path);
    await this.files.with_file_lock(this.transaction_lock_path, async () => {
      await this.files.append_file(this.turns_file_path, `${JSON.stringify(turn)}\n`);
    });
  }

  /** 读取状态日志；只允许修复进程中断产生的最后一条残缺记录。 */
  private async read_records(repair_tail: boolean): Promise<GroupDispatchTurnRecord[]> {
    const content = (await this.files.read_file(this.turns_file_path)).toString("utf8");
    const lines = content.split("\n");
    const records: GroupDispatchTurnRecord[] = [];
    for (let line_index = 0; line_index < lines.length; line_index += 1) {
      const line = lines[line_index];
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as GroupDispatchTurnRecord;
        assert_dispatch_turn(record);
        records.push(record);
      } catch (error) {
        const is_tail = lines.slice(line_index + 1).every((item) => !item.trim());
        if (!repair_tail || !is_tail) throw error;
        const repaired = records.map((record) => JSON.stringify(record)).join("\n");
        await this.files.write_file_atomically(
          this.turns_file_path,
          repaired ? `${repaired}\n` : "",
        );
        break;
      }
    }
    return records;
  }
}

/** 防止损坏的持久化记录进入 Dispatch Session 恢复流程。 */
function assert_dispatch_turn(value: GroupDispatchTurnRecord): void {
  if (!value || typeof value !== "object") throw new Error("Invalid Group dispatch turn record");
  if (typeof value.dispatch_id !== "string" || !value.dispatch_id.trim()) {
    throw new Error("Invalid Group dispatch turn id");
  }
  if (value.trigger !== "user" && value.trigger !== "auto") {
    throw new Error(`Invalid Group dispatch trigger: ${String(value.trigger)}`);
  }
  if (typeof value.message_id !== "string" || !value.message_id.trim()) {
    throw new Error(`Invalid Group dispatch message id: ${value.dispatch_id}`);
  }
  if (!Array.isArray(value.pending_message_ids) || value.pending_message_ids.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Invalid Group dispatch pending messages: ${value.dispatch_id}`);
  }
  if (!dispatch_turn_statuses.has(value.status)) {
    throw new Error(`Invalid Group dispatch status: ${String(value.status)}`);
  }
  if (!Number.isFinite(value.created_at) || !Number.isFinite(value.updated_at)) {
    throw new Error(`Invalid Group dispatch timestamps: ${value.dispatch_id}`);
  }
  if (value.status === "completed" && !value.decision) {
    throw new Error(`Completed Group dispatch is missing its decision: ${value.dispatch_id}`);
  }
}
