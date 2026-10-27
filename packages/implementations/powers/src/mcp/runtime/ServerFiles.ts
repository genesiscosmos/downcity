/**
 * 全局 MCP Server 定义的文件存储与校验。
 *
 * 只从宿主 Power config.path 的父目录定位 servers/，不读取旧 config.servers，
 * 不迁移配置、不解析安装清单、不执行命令。每个 TOML 独立校验，错误原文仍可编辑。
 * 单文件保存采用同目录临时文件和 rename；保存、删除都要求原文匹配，防止过期界面
 * 覆盖手工修改或凭据。所有写入只接受受限文件名，拒绝符号链接文件。
 */

import { link, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parse } from "smol-toml";
import { z } from "zod";
import type { PowerJsonValue } from "@downcity/city/power";
import type { McpServerConfig } from "../types/Mcp.js";
import type { McpServerFileScan, McpServerFilesView } from "../types/McpServerFiles.js";

const server_schema = z.object({
  title: z.string().optional(),
  enabled: z.boolean().default(true),
  command: z.string().trim().min(1).optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().trim().min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "URL must use http or https").optional(),
  headers: z.record(z.string(), z.string()).optional(),
  auth: z.literal("oauth").optional(),
  client_id: z.string().trim().min(1).optional(),
  client_name: z.string().trim().min(1).optional(),
  request_timeout_ms: z.number().int().positive().max(300_000).default(60_000),
  max_result_chars: z.number().int().positive().default(100_000),
}).strict().superRefine((value, context) => {
  if (Boolean(value.command) === Boolean(value.url)) context.addIssue({ code: "custom", message: "Exactly one of command or url is required" });
  if (value.command && [value.auth, value.client_id, value.client_name].some((item) => item !== undefined)) context.addIssue({ code: "custom", message: "OAuth requires url" });
  if (value.command && value.headers !== undefined) context.addIssue({ code: "custom", message: "headers requires url" });
  if (value.url && [value.args, value.cwd, value.env].some((item) => item !== undefined)) context.addIssue({ code: "custom", message: "args, cwd and env require command" });
});
const save_schema = z.object({ server_id: z.string(), content: z.string(), expected_content: z.string().optional(), create: z.boolean().optional() }).strict();
const remove_schema = z.object({ server_id: z.string(), expected_content: z.string() }).strict();

/** 读取一个文件定义并转换成内部传输配置；磁盘格式始终保持扁平。 */
export function parse_server_file(server_id: string, content: string): McpServerConfig {
  validate_server_id(server_id);
  const value = server_schema.parse(parse(content));
  return {
    id: server_id, title: value.title, enabled: value.enabled,
    request_timeout_ms: value.request_timeout_ms, max_result_chars: value.max_result_chars,
    transport: value.command
      ? { type: "stdio", command: value.command, args: value.args, cwd: value.cwd, env: value.env }
      : { type: "http", url: value.url!, headers: value.headers, auth: value.auth, client_id: value.client_id, client_name: value.client_name },
  };
}

/** 全局目录的唯一文件读写入口。 */
export class McpServerFiles {
  /** 宿主提供的实际全局目录，不依赖进程 HOME 或工作区目录。 */
  readonly directory: string;
  /** 串行化本实例管理动作，防止同一界面的并发写入交错。 */
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(config_path: string | undefined) {
    if (!config_path) throw new Error("MCP requires a host Power config.path to locate its global servers directory");
    this.directory = join(dirname(config_path), "servers");
  }

  /** 每次从真实文件扫描；坏文件不会使有效文件消失。 */
  async scan(): Promise<McpServerFileScan> {
    const result: McpServerFileScan = { directory: this.directory, servers: [], configs: [] };
    const entries = await readdir(this.directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.name.endsWith(".toml")) continue;
      const id = entry.name.slice(0, -5);
      const path = join(this.directory, entry.name);
      let content = "";
      try {
        validate_server_id(id);
        if (!entry.isFile()) throw new Error("Server definition must be a regular file (no symlinks)");
        content = await readFile(path, "utf8");
        result.configs.push(parse_server_file(id, content));
        result.servers.push({ id, path, content });
      } catch (error) {
        result.servers.push({ id, path, content, error: error_message(error) });
      }
    }
    return result;
  }

  /** 返回管理界面需要的完整原文快照；不得用于 Agent 动作。 */
  async read(): Promise<McpServerFilesView> {
    const { directory, servers } = await this.scan();
    return { directory, servers };
  }

  /** 校验并原子保存单个文件，新建必须显式 create，修改必须提供载入原文。 */
  async save(input: PowerJsonValue | undefined): Promise<void> {
    const value = save_schema.parse(input);
    parse_server_file(value.server_id, value.content);
    await this.mutate(async () => {
      const path = this.server_path(value.server_id);
      const current = await this.current_content(path);
      if (value.create) {
        if (current !== undefined) throw new Error(`MCP server already exists: ${value.server_id}`);
      } else if (current === undefined || value.expected_content === undefined || current !== value.expected_content) {
        throw new Error("MCP file changed or was removed. Refresh before saving.");
      }
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary_path = join(this.directory, `.${value.server_id}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary_path, value.content, { encoding: "utf8", mode: 0o600, flag: "wx" });
        // 新建用独占创建保护已存在文件；更新用 rename 避免出现半写入 TOML。
        if (value.create) await link(temporary_path, path);
        else await rename(temporary_path, path);
      } finally {
        await unlink(temporary_path).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      }
    });
  }

  /** 仅删除明确选定且原文未变化的一个 Server 文件。 */
  async remove(input: PowerJsonValue | undefined): Promise<void> {
    const value = remove_schema.parse(input);
    await this.mutate(async () => {
      const path = this.server_path(value.server_id);
      if (await this.current_content(path) !== value.expected_content) throw new Error("MCP file changed or was removed. Refresh before removing.");
      await unlink(path);
    });
  }

  /** 受限 ID 直接对应文件名，禁止路径穿越。 */
  private server_path(server_id: string): string {
    validate_server_id(server_id);
    return join(this.directory, `${server_id}.toml`);
  }

  /** 检查文件类型后读取完整原文；不存在与空文件不同。 */
  private async current_content(path: string): Promise<string | undefined> {
    try {
      if (!(await lstat(path)).isFile()) throw new Error("Server definition must be a regular file (no symlinks)");
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  /** 前一次失败不阻止后续独立文件操作。 */
  private async mutate(operation: () => Promise<void>): Promise<void> {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.catch(() => undefined);
    await next;
  }
}

/** 文件名与动作参数使用同一套稳定 ID 约束。 */
function validate_server_id(server_id: string): void {
  if (!/^[a-z][a-z0-9_-]*$/.test(server_id)) throw new Error(`Invalid MCP server id: ${server_id}`);
}

/** 将单文件失败转换成可展示错误，不携带原文。 */
function error_message(error: unknown): string {
  // 完整校验原因只在配置界面展示；Power 的模型侧状态另用固定提示。
  return error instanceof Error ? error.message : String(error);
}
