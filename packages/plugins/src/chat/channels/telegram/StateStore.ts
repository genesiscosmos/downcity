import path from "path";
import fs from "fs-extra";
import type { JsonObject } from "@downcity/agent";

/**
 * Telegram 轮询模式的持久化状态存储。
 *
 * 关键点（中文）
 * - 保存 lastUpdateId，避免重启后重复消费
 * - 所有 I/O 都是 best-effort，不能阻断主流程
 *
 * Persistent state for Telegram polling mode.
 *
 * Telegram's getUpdates polling relies on a monotonic `offset`. Persisting the
 * last processed update id avoids re-processing after restarts.
 *
 * All I/O in this module is best-effort: failures should not break the bot.
 */
export class TelegramStateStore {
  private readonly lastUpdateIdFile: string;

  constructor(project_root: string) {
    const dir = path.join(project_root, ".downcity", ".cache", "telegram");
    this.lastUpdateIdFile = path.join(dir, "lastUpdateId.json");
  }

  /**
   * 读取最后一次处理的 update_id。
   */
  async loadLastUpdateId(): Promise<number | undefined> {
    try {
      if (!(await fs.pathExists(this.lastUpdateIdFile))) return undefined;
      const data = (await fs.readJson(this.lastUpdateIdFile)) as JsonObject;
      const value = Number(data?.lastUpdateId);
      if (Number.isFinite(value) && value > 0) return value;
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 持久化最后一次处理的 update_id。
   */
  async saveLastUpdateId(lastUpdateId: number): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.lastUpdateIdFile));
      await fs.writeJson(
        this.lastUpdateIdFile,
        { lastUpdateId },
        { spaces: 2 },
      );
    } catch {
      // ignore
    }
  }

}
