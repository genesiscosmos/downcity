/**
 * Cloudflare Computer Workspace 适配器。
 *
 * 职责说明（中文）
 * - 将 Cloudflare Computer 的持久化虚拟文件系统接入 Downcity WorkspaceBase。
 * - 保持 Agent、Session、Store 和 WorkspaceTools 不感知 Cloudflare RPC 细节。
 * - Runtime 执行由调用方通过 Cloudflare Computer tools 配置；本适配器不伪造本地 Shell。
 */

import {
  WorkspaceBase,
} from "@downcity/agent";
import type {
  SessionStore,
  FileSystem,
  WorkspaceDirectoryEntry,
  WorkspaceEnvPatch,
  WorkspaceEnvSubscriber,
  WorkspaceEnvUnsubscribe,
  WorkspaceTools,
} from "@downcity/agent";
import { createAITools } from "@cloudflare/computer/tools";
import { tool } from "ai";
import { z } from "zod";
import type { Shell } from "@downcity/shell";
import type {
  CloudflareComputerFileApi,
  CloudflareComputerWorkspaceOptions,
} from "@/types/CloudflareComputerWorkspace.js";
import type {
  FileToolActionRequest,
  FileToolActionResult,
} from "@downcity/agent";
import type {
  SearchToolActionRequest,
  SearchToolActionResult,
} from "@downcity/agent";

class CloudflareComputerFileSystem implements FileSystem {
  readonly root_path: string;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly remote_fs: CloudflareComputerFileApi, root_path: string) {
    this.root_path = root_path;
  }

  resolve_path(...segments: string[]): string {
    const root_segments = this.root_path.split("/").filter(Boolean);
    const input = segments.join("/").replaceAll("\\", "/");
    const input_segments = input.split("/");
    const resolved = input.startsWith("/") ? [] : [...root_segments];
    for (const segment of input_segments) {
      if (!segment || segment === ".") continue;
      if (segment === "..") {
        if (resolved.length <= root_segments.length) {
          throw new Error(`Path escapes Workspace: ${segments.join("/")}`);
        }
        resolved.pop();
        continue;
      }
      resolved.push(segment);
    }
    const result = `/${resolved.join("/")}`;
    if (result !== this.root_path && !result.startsWith(`${this.root_path}/`)) {
      throw new Error(`Path escapes Workspace: ${segments.join("/")}`);
    }
    return result;
  }
  async path_exists(file_path: string): Promise<boolean> {
    return await this.remote_fs.stat(this.resolve_path(file_path)).then(() => true).catch(() => false);
  }
  async read_file(file_path: string): Promise<Buffer> {
    const value = await this.remote_fs.readFile(this.resolve_path(file_path));
    return await read_cloudflare_file(value);
  }
  async file_size(file_path: string): Promise<number> {
    return (await this.remote_fs.stat(this.resolve_path(file_path))).size;
  }
  async ensure_directory(directory_path: string): Promise<void> {
    await this.remote_fs.mkdir(this.resolve_path(directory_path), { recursive: true });
  }
  async remove_path(target_path: string): Promise<void> {
    await this.remote_fs.rm(this.resolve_path(target_path), { recursive: true })
      .catch(async (error: unknown) => {
        if (!await this.path_exists(target_path)) return;
        throw error;
      });
  }
  async move_path(source_path: string, target_path: string): Promise<void> {
    await this.remote_fs.rename(this.resolve_path(source_path), this.resolve_path(target_path));
  }
  async read_directory(directory_path: string): Promise<WorkspaceDirectoryEntry[]> {
    const entries = await this.remote_fs.readdir(this.resolve_path(directory_path));
    return entries.map((entry) => ({
      name: entry.name,
      is_directory: entry.isDirectory === true,
      is_file: entry.isFile !== false && entry.isDirectory !== true,
    }));
  }
  async write_file_atomically(file_path: string, content: string | Buffer): Promise<void> {
    await this.remote_fs.writeFile(this.resolve_path(file_path), content);
  }
  async append_file(file_path: string, content: string | Buffer): Promise<void> {
    const current = await this.read_file(file_path).catch(() => Buffer.alloc(0));
    await this.write_file_atomically(file_path, Buffer.concat([current, Buffer.from(content)]));
  }
  async with_file_lock<T>(lock_path: string, action: () => Promise<T>): Promise<T> {
    const key = this.resolve_path(lock_path);
    const previous = this.locks.get(key) || Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.locks.set(key, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === queued) this.locks.delete(key);
    }
  }
  async run_file_action(_request: FileToolActionRequest): Promise<FileToolActionResult> {
    throw new Error(
      "Cloudflare Computer file actions must be supplied by @cloudflare/computer/tools",
    );
  }
  async run_search_action(_request: SearchToolActionRequest): Promise<SearchToolActionResult> {
    throw new Error(
      "Cloudflare Computer search actions must be supplied by @cloudflare/computer/tools",
    );
  }
}

/** 将 Cloudflare Computer 虚拟文件系统作为 Downcity Agent Workspace 使用。 */
export class CloudflareComputerWorkspace extends WorkspaceBase {
  readonly id: string;
  readonly path: string;
  readonly files: FileSystem;
  readonly tools: WorkspaceTools;
  readonly shell: Shell | undefined;
  private readonly env: Record<string, string>;
  private readonly env_subscribers = new Set<WorkspaceEnvSubscriber>();
  private session_store?: SessionStore;
  private disposed = false;
  private readonly dispose_computer?: CloudflareComputerWorkspaceOptions["dispose"];

  constructor(options: CloudflareComputerWorkspaceOptions) {
    super();
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("CloudflareComputerWorkspace requires a stable id");
    this.path = normalize_root_path(options.root_path || "/workspace");
    this.files = new CloudflareComputerFileSystem(
      options.computer.fs as CloudflareComputerFileApi,
      this.path,
    );
    const computer_tools = {
      ...createAITools({ workspace: options.computer }),
      exec: create_cloudflare_exec_tool(options.computer),
    };
    // Cloudflare Computer 与 Downcity 可能由 pnpm 解析到 AI SDK 6 的不同补丁版本。
    // ToolSet 的运行时协议兼容，但泛型 Schema 使用不同模块实例；只在适配边界统一类型。
    this.tools = computer_tools as unknown as WorkspaceTools;
    this.env = Object.fromEntries(
      Object.entries(options.env || {}).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    this.shell = undefined;
    this.dispose_computer = options.dispose;
  }
  get_env(): Record<string, string> {
    return { ...this.env };
  }

  set_env(next: WorkspaceEnvPatch): void {
    for (const key of Object.keys(this.env)) delete this.env[key];
    this.patch_env(next);
  }

  patch_env(patch: WorkspaceEnvPatch): void {
    for (const [key, value] of Object.entries(patch || {})) {
      if (value === null || value === undefined) delete this.env[key];
      else this.env[key] = String(value);
    }
    const snapshot = Object.freeze(this.get_env());
    for (const subscriber of this.env_subscribers) {
      try {
        subscriber(snapshot);
      } catch {
        // 观察者失败不能回滚已经完成的远程环境更新。
      }
    }
  }

  subscribe_env(subscriber: WorkspaceEnvSubscriber): WorkspaceEnvUnsubscribe {
    this.env_subscribers.add(subscriber);
    return () => this.env_subscribers.delete(subscriber);
  }

  create_session_store(agent_id: string): SessionStore {
    const resolved_agent_id = String(agent_id || "").trim();
    if (!resolved_agent_id) {
      throw new Error("Workspace.create_session_store requires a non-empty agent_id");
    }
    if (this.disposed) throw new Error("Cannot bind a disposed Workspace");
    if (this.session_store) throw new Error("Workspace is already bound to an Agent");
    const store = this.create_default_session_store(resolved_agent_id);
    this.session_store = store;
    return store;
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const results = await Promise.allSettled([
      this.session_store?.dispose() ?? Promise.resolve(),
      this.dispose_computer?.() ?? Promise.resolve(),
    ]);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, "Workspace dispose failed");
  }
}

/** 创建使用 Computer 默认 Runtime backend 的命令工具。 */
function create_cloudflare_exec_tool(
  computer: CloudflareComputerWorkspaceOptions["computer"],
) {
  return tool({
    description:
      "Run a command in the Cloudflare Computer Workspace. The configured default runtime backend is used unless backend is provided.",
    inputSchema: z.object({
      command: z.string().min(1).describe("Shell command to execute."),
      cwd: z.string().optional().describe("Optional Workspace working directory."),
      backend: z.string().optional().describe("Optional configured Computer backend id."),
    }),
    execute: async ({ command, cwd, backend }) => {
      try {
        const handle = await computer.shell.exec(command, {
          encoding: "utf8",
          ...(cwd ? { cwd } : {}),
          ...(backend ? { backend } : {}),
        });
        const result = await handle.result();
        return {
          command,
          cwd: cwd || null,
          backend: backend || null,
          exit_code: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      } catch (error) {
        return {
          command,
          cwd: cwd || null,
          backend: backend || null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

/** 将 Cloudflare Computer 的文本、字节或流结果统一转换为 Node Buffer。 */
async function read_cloudflare_file(
  value: string | Uint8Array | ReadableStream<Uint8Array>,
): Promise<Buffer> {
  if (typeof value === "string" || value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  const reader = value.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

/** 规范化 Cloudflare Computer Workspace 的逻辑根路径。 */
function normalize_root_path(input: string): string {
  const normalized = `/${String(input || "").replaceAll("\\", "/")}`
    .replaceAll(/\/+/g, "/")
    .replace(/\/$/, "");
  return normalized || "/";
}
