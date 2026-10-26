/**
 * MCP OAuth 凭据的持久化存储。
 *
 * 凭据按 server id / endpoint / issuer 隔离为独立文件，与 server TOML
 * 定义目录同级（`<config-dir>/servers/../auth/`，即 `<config-dir>/auth/`）。
 * 写入使用临时文件 + rename 原子替换，文件权限 0600，目录 0700。
 * 不落 code_verifier 等一次性中间态；安全水位与现有明文 headers 对齐。
 */

import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { OAuthClientInformationFullSchema, OAuthClientInformationSchema, OAuthTokensSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { z } from "zod";
import type { McpOAuthCredential } from "./OAuthTypes.js";

/** 磁盘上的凭据文件结构。 */
const credential_file_schema = z.object({
  issuer: z.string(),
  client: z.union([OAuthClientInformationFullSchema, OAuthClientInformationSchema]).optional(),
  endpoint: z.string(),
  expires_at: z.number().optional(),
  tokens: OAuthTokensSchema.optional(),
}).strict();

/** 读取和写入单个 server 凭据文件的唯一入口。 */
export class McpOAuthStorage {
  /** 凭据目录绝对路径。 */
  readonly directory: string;

  /**
   * @param config_directory 宿主 Power config.path 的父目录，凭据与其同级 `auth/` 下。
   */
  constructor(config_directory: string) {
    this.directory = join(config_directory, "auth");
  }

  /** 读取一个凭据文件；不存在或损坏都返回 undefined 并按无凭据处理。 */
  async load(server_id: string): Promise<McpOAuthCredential | undefined> {
    let raw: string;
    try {
      const file_path = this.credential_path(server_id);
      if (!(await lstat(file_path)).isFile()) throw new Error("Invalid OAuth credential file");
      await chmod(file_path, 0o600);
      raw = await readFile(file_path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    try {
      return credential_file_schema.parse(JSON.parse(raw)) as McpOAuthCredential;
    } catch {
      // 损坏文件不阻塞其他操作；后续授权会覆盖它。
      return undefined;
    }
  }

  /** 原子保存凭据；目录与文件权限分别收紧到 0700 / 0600。 */
  async save(server_id: string, credential: McpOAuthCredential): Promise<void> {
    credential_file_schema.parse(credential);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const final_path = this.credential_path(server_id);
    if (!(await lstat(this.directory)).isDirectory()) throw new Error("OAuth storage must be a real directory");
    await chmod(this.directory, 0o700);
    const temporary_path = `${final_path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary_path, JSON.stringify(credential), { mode: 0o600, flag: "wx" });
      await rename(temporary_path, final_path);
    } finally {
      await unlink(temporary_path).catch(() => undefined);
    }
  }

  /** 删除凭据文件；用于"重新授权"。文件不存在不算错误。 */
  async remove(server_id: string): Promise<void> {
    await unlink(this.credential_path(server_id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  /** 凭据文件稳定路径；server id 由 ServerFiles 的同一套规则约束。 */
  private credential_path(server_id: string): string {
    return join(this.directory, `${createHash("sha256").update(server_id).digest("hex")}.json`);
  }
}
