/** Shell快照的串行原子写入，避免输出更新覆盖退出与投递确认。 */
import fs from "fs-extra";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ShellSessionSnapshot } from "@downcity/type/shell";

/** 仅保存进行中的文件操作；事实仍以快照文件为准。 */
const writes = new Map<string, Promise<void>>();

/** 调用时捕获快照，按路径串行落盘；失败不阻止后续明确重试。 */
export async function write_shell_snapshot(file_path: string, snapshot: ShellSessionSnapshot): Promise<void> {
  const text = JSON.stringify(snapshot, null, 2);
  const operation = (writes.get(file_path) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    await fs.ensureDir(path.dirname(file_path));
    const temporary = `${file_path}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, text, "utf8");
      await fs.rename(temporary, file_path);
    } finally { await fs.remove(temporary); }
  });
  writes.set(file_path, operation);
  try { await operation; } finally { if (writes.get(file_path) === operation) writes.delete(file_path); }
}
