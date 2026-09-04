/**
 * Cloudflare Computer Workspace 公开类型。
 *
 * 职责说明（中文）
 * - 描述适配器依赖的最小 Cloudflare Computer client 形状。
 * - 不复制 Cloudflare Computer 的完整 API，避免将 Preview 类型扩散到 Agent 核心包。
 */

import type { WorkspaceClient } from "@cloudflare/computer";

/** Cloudflare Computer 目录条目。 */
export interface CloudflareComputerDirectoryEntry {
  /** 当前目录条目的原始名称。 */
  name: string;
  /** 当前条目是否为目录。 */
  isDirectory?: boolean;
  /** 当前条目是否为普通文件。 */
  isFile?: boolean;
}

/** Cloudflare Computer 文件元数据。 */
export interface CloudflareComputerFileStat {
  /** 当前文件的字节大小。 */
  size: number;
  /** 当前路径是否为目录。 */
  isDirectory?: boolean;
  /** 当前路径是否为普通文件。 */
  isFile?: boolean;
}

/** Cloudflare Computer 最小文件系统形状。 */
export interface CloudflareComputerFileApi {
  /** 读取指定绝对虚拟路径的文件内容。 */
  readFile(path: string, encoding?: "utf8"): Promise<string | Uint8Array | ReadableStream<Uint8Array>>;
  /** 写入指定绝对虚拟路径的完整文件内容。 */
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  /** 创建指定虚拟目录及可选父目录。 */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** 返回指定虚拟目录的直接子条目。 */
  readdir(path: string): Promise<CloudflareComputerDirectoryEntry[]>;
  /** 删除指定虚拟文件或目录。 */
  rm(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** 在同一 Computer Workspace 内移动文件或目录。 */
  rename(source_path: string, target_path: string): Promise<void>;
  /** 返回指定虚拟路径的文件元数据。 */
  stat(path: string): Promise<CloudflareComputerFileStat>;
}

/** Cloudflare Computer Workspace client 的最小形状。 */
/** Cloudflare Computer 的远程 Workspace client。 */
export type CloudflareComputerClient = WorkspaceClient;

/** Cloudflare Computer Workspace 构造参数。 */
export interface CloudflareComputerWorkspaceOptions {
  /** 当前 Workspace 的稳定逻辑标识。 */
  id: string;
  /** 由 `getWorkspace()` 返回的 Cloudflare Computer Workspace client。 */
  computer: CloudflareComputerClient;
  /** 供 Downcity Agent 使用的稳定逻辑根路径。 */
  root_path?: string;
  /** 初始 Workspace 环境变量。 */
  env?: Record<string, string | undefined>;
  /** 释放远程 Computer stub 的可选回调。 */
  dispose?: () => void | Promise<void>;
}
