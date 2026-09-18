/**
 * 本地底层存储 Provider。
 *
 * 关键点（中文）
 * - Provider 只负责根目录、路径片段隔离和文件能力。
 * - 同一 Provider 可以打开多个独立作用域；资源所有权由上层 Agent private runtime directory 管理。
 * - 不理解 Agent、Session 或 Power 的业务语义。
 */

import path from "node:path";
import fs from "fs-extra";
import { LocalFileSystem } from "@/workspace/LocalFileSystem.js";
import type {
  StorageProvider,
  StorageScope,
} from "@downcity/type/workspace";

/** 本地文件系统存储 Provider。 */
export class LocalStorageProvider implements StorageProvider {
  private readonly opened_scopes = new Map<string, StorageScope>();

  constructor(private readonly root_path: string) {}

  /** 打开一个只能访问用户级根目录内的逻辑作用域。 */
  open_scope(segments: readonly string[]): StorageScope {
    const normalized_segments = segments.map(normalize_storage_segment);
    if (normalized_segments.length === 0) {
      throw new Error("Storage scope requires at least one segment");
    }
    const scope_key = normalized_segments.join("/");
    const existing_scope = this.opened_scopes.get(scope_key);
    if (existing_scope) return existing_scope;

    const storage_root_path = normalized_segments.reduce(
      (current_path, segment) => path.join(current_path, encodeURIComponent(segment)),
      path.resolve(this.root_path),
    );
    ensure_private_directory_tree(path.resolve(this.root_path), storage_root_path);
    const scope: StorageScope = {
      root_path: storage_root_path,
      files: new LocalFileSystem({
        root_path: storage_root_path,
        directory_mode: 0o700,
        file_mode: 0o600,
      }),
      database_location: { type: "file" },
    };
    this.opened_scopes.set(scope_key, scope);
    return scope;
  }
}

/** 归一化并限制一个逻辑存储片段。 */
function normalize_storage_segment(value: string): string {
  const segment = String(value || "").trim();
  if (!segment || segment === "." || segment === "..") {
    throw new Error("Storage scope contains an invalid segment");
  }
  if (segment.includes("/") || segment.includes("\\") || path.isAbsolute(segment)) {
    throw new Error("Storage scope segment cannot contain a path");
  }
  return segment;
}

/** 创建并收紧本地私有目录链权限。 */
function ensure_private_directory_tree(
  data_root_path: string,
  storage_root_path: string,
): void {
  const relative_path = path.relative(data_root_path, storage_root_path);
  if (relative_path.startsWith("..") || path.isAbsolute(relative_path)) {
    throw new Error("Storage scope escapes its root");
  }
  const segments = relative_path.split(path.sep).filter(Boolean);
  let current_path = data_root_path;
  fs.ensureDirSync(current_path, { mode: 0o700 });
  fs.chmodSync(current_path, 0o700);
  for (const segment of segments) {
    current_path = path.join(current_path, segment);
    fs.ensureDirSync(current_path, { mode: 0o700 });
    fs.chmodSync(current_path, 0o700);
  }
}
