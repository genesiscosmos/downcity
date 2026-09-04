/**
 * 文件工具原子写入器。
 *
 * 关键点（中文）
 * - 新文件使用 `wx` 保证不会覆盖并发创建的文件。
 * - 覆盖文件时在同目录写临时文件，再通过 rename 原子替换。
 * - 临时文件写入后执行 fsync，并尽力清理失败残留。
 */

import path from "node:path";
import crypto from "node:crypto";
import { chmod, open, rename, unlink } from "node:fs/promises";

/** 将字节内容安全写入目标文件。 */
export async function write_file_atomically(params: {
  /** 已通过路径策略校验的目标绝对路径。 */
  file_path: string;
  /** 要写入的完整字节内容。 */
  content: Buffer;
  /** 是否允许替换已有文件。 */
  overwrite: boolean;
  /** 覆盖时需要保留的原文件权限位。 */
  mode?: number;
}): Promise<void> {
  if (!params.overwrite) {
    const file_handle = await open(params.file_path, "wx", params.mode ?? 0o666);
    try {
      await file_handle.writeFile(params.content);
      await file_handle.sync();
    } finally {
      await file_handle.close();
    }
    return;
  }

  const directory_path = path.dirname(params.file_path);
  const temporary_path = path.join(
    directory_path,
    `.${path.basename(params.file_path)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let temporary_exists = false;
  try {
    const file_handle = await open(temporary_path, "wx", params.mode ?? 0o666);
    temporary_exists = true;
    try {
      await file_handle.writeFile(params.content);
      await file_handle.sync();
    } finally {
      await file_handle.close();
    }
    if (typeof params.mode === "number") {
      await chmod(temporary_path, params.mode);
    }
    await rename(temporary_path, params.file_path);
    temporary_exists = false;
  } finally {
    if (temporary_exists) {
      await unlink(temporary_path).catch(() => undefined);
    }
  }
}
