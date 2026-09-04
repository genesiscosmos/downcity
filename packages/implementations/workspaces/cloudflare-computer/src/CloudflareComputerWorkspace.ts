/**
 * Cloudflare Computer Workspace 适配器。
 *
 * 职责说明（中文）
 * - 将 Cloudflare Computer 的持久化虚拟文件系统接入 Downcity WorkspaceRuntime。
 * - 保持 Agent、Session、Store 和 WorkspaceTools 不感知 Cloudflare RPC 细节。
 * - Runtime 执行由调用方通过 Cloudflare Computer tools 配置；本适配器不伪造本地 Shell。
 */

import { define_runtime_tool } from "@downcity/type";
import type {
  FileSystem,
  WorkspaceDirectoryEntry,
  WorkspaceEnvPatch,
  WorkspaceEnvSubscriber,
  WorkspaceEnvUnsubscribe,
  WorkspaceShell,
  WorkspaceRuntime,
  WorkspaceTools,
} from "@downcity/type/workspace";
import { z } from "zod";
import type {
  CloudflareComputerFileApi,
  CloudflareComputerWorkspaceOptions,
} from "@/types/CloudflareComputerWorkspace.js";
import type {
  FileToolActionRequest,
  FileToolActionResult,
} from "@downcity/type/workspace";
import type {
  SearchToolActionRequest,
  SearchToolActionResult,
} from "@downcity/type/workspace";

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
export class CloudflareComputerWorkspace implements WorkspaceRuntime {
  readonly id: string;
  readonly path: string;
  readonly files: FileSystem;
  readonly tools: WorkspaceTools;
  readonly shell: WorkspaceShell | undefined;
  private readonly env: Record<string, string>;
  private readonly env_subscribers = new Set<WorkspaceEnvSubscriber>();
  private readonly remote_fs: CloudflareComputerFileApi;
  private disposed = false;
  private readonly dispose_computer?: CloudflareComputerWorkspaceOptions["dispose"];

  constructor(options: CloudflareComputerWorkspaceOptions) {
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("CloudflareComputerWorkspace requires a stable id");
    this.path = normalize_root_path(options.root_path || "/workspace");
    this.remote_fs = options.computer.fs as CloudflareComputerFileApi;
    this.files = new CloudflareComputerFileSystem(this.remote_fs, this.path);
    const computer_tools: WorkspaceTools = {
      ...create_cloudflare_file_tools(this.files),
      exec: create_cloudflare_exec_tool(options.computer),
    };
    this.tools = computer_tools;
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

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const results = await Promise.allSettled([
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
  return define_runtime_tool<z.infer<typeof cloudflare_exec_input_schema>>({
    description:
      "Run a command in the Cloudflare Computer Workspace. The configured default runtime backend is used unless backend is provided.",
    input_schema: cloudflare_exec_input_schema,
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

const cloudflare_exec_input_schema = z.object({
  command: z.string().min(1).describe("Shell command to execute."),
  cwd: z.string().optional().describe("Optional Workspace working directory."),
  backend: z.string().optional().describe("Optional configured Computer backend id."),
});

const cloudflare_read_input_schema = z.object({
  path: z.string().min(1).describe("Workspace-relative file path."),
  offset: z.number().int().nonnegative().optional().describe("Zero-based first line."),
  limit: z.number().int().positive().max(2_000).optional().describe("Maximum returned lines."),
});

const cloudflare_write_input_schema = z.object({
  path: z.string().min(1).describe("Workspace-relative file path."),
  content: z.string().describe("Complete UTF-8 file content."),
});

const cloudflare_edit_input_schema = z.object({
  path: z.string().min(1).describe("Workspace-relative file path."),
  edits: z.array(z.object({
    old_text: z.string().min(1).describe("Exact text to replace once."),
    new_text: z.string().describe("Replacement text."),
  })).min(1).describe("Ordered exact replacements."),
});

const cloudflare_list_input_schema = z.object({
  path: z.string().default(".").describe("Workspace-relative directory path."),
});

/** 创建不依赖第三方模型 SDK 的 Cloudflare 文件工具。 */
function create_cloudflare_file_tools(files: FileSystem): WorkspaceTools {
  return {
    read: define_runtime_tool<z.infer<typeof cloudflare_read_input_schema>>({
      description: "Read a UTF-8 file from the Cloudflare Computer Workspace.",
      input_schema: cloudflare_read_input_schema,
      execute: async (input) => {
        const lines = (await files.read_file(input.path)).toString("utf8").split(/\r?\n/u);
        const start_line = input.offset ?? 0;
        const limit = input.limit ?? 2_000;
        const selected = lines.slice(start_line, start_line + limit);
        return {
          path: input.path,
          content: selected.join("\n"),
          start_line,
          end_line: selected.length > 0 ? start_line + selected.length - 1 : start_line,
          total_lines: lines.length,
          truncated: start_line + selected.length < lines.length,
        };
      },
    }),
    write: define_runtime_tool<z.infer<typeof cloudflare_write_input_schema>>({
      description: "Write a complete UTF-8 file in the Cloudflare Computer Workspace.",
      input_schema: cloudflare_write_input_schema,
      execute: async (input) => {
        await files.ensure_directory(resolve_parent_directory(input.path));
        await files.write_file_atomically(input.path, input.content);
        return { path: input.path, bytes_written: Buffer.byteLength(input.content) };
      },
    }),
    edit: define_runtime_tool<z.infer<typeof cloudflare_edit_input_schema>>({
      description: "Apply ordered exact replacements to a UTF-8 Workspace file.",
      input_schema: cloudflare_edit_input_schema,
      execute: async (input) => {
        let content = (await files.read_file(input.path)).toString("utf8");
        for (const edit of input.edits) {
          const first_index = content.indexOf(edit.old_text);
          if (first_index < 0 || content.indexOf(edit.old_text, first_index + 1) >= 0) {
            throw new Error("Each edit old_text must match exactly once");
          }
          content = `${content.slice(0, first_index)}${edit.new_text}${content.slice(first_index + edit.old_text.length)}`;
        }
        await files.write_file_atomically(input.path, content);
        return { path: input.path, edits_applied: input.edits.length };
      },
    }),
    ls: define_runtime_tool<z.infer<typeof cloudflare_list_input_schema>>({
      description: "List a directory in the Cloudflare Computer Workspace.",
      input_schema: cloudflare_list_input_schema,
      execute: async (input) => ({
        path: input.path,
        entries: await files.read_directory(input.path),
      }),
    }),
  };
}

/** 从 Workspace 相对路径中读取父目录。 */
function resolve_parent_directory(file_path: string): string {
  const normalized = file_path.replaceAll("\\", "/");
  const separator_index = normalized.lastIndexOf("/");
  return separator_index > 0 ? normalized.slice(0, separator_index) : ".";
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
