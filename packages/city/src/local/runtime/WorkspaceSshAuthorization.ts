/**
 * 本地 Workspace 的 SSH 授权准备与状态服务。
 *
 * 不启动网络探测，不读取私钥，也不自行变更正在运行的 Workspace。
 * 应用层必须在停用旧实例的独占切换内调用 commit_authorization/revoke，
 * 并在装配 Provider 前调用 resolve_access，避免复用已失效或被替换的 socket。
 */

import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceRuntime } from "@downcity/type/workspace";
import type { CityWorkspaces } from "../../city/types/City.js";
import type { WorkspaceRepository } from "../repositories/WorkspaceRepository.js";
import type { LocalWorkspaceConfig } from "../types/LocalConfig.js";
import type { LocalWorkspaceSshAuthorization, LocalWorkspaceSshInput, LocalWorkspaceSshStatus } from "../types/WorkspaceSsh.js";

/** 检查路径是否位于指定根目录，包含根本身。 */
function contains_path(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** 只导入用户已独立核验的完整 known_hosts 记录，禁止配置指令和空信任集。 */
function normalize_known_hosts(input: string): string {
  if (Buffer.byteLength(input, "utf8") > 1024 * 1024 || /[\0\r]/.test(input)) {
    throw new Error("Invalid known_hosts input");
  }
  const entries = input.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (!entries.length) throw new Error("Import at least one independently verified known_hosts entry");
  for (const entry of entries) {
    // 不隐式接受 CA/撤销标记，避免首版导入引入超出单主机密钥的信任语义。
    if (!/^\S+\s+(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521))\s+[A-Za-z0-9+/]+={0,2}(?:\s+[^\0\r\n]*)?$/.test(entry)) {
      throw new Error("Import plain OpenSSH known_hosts records; CA markers and malformed entries are not supported");
    }
  }
  return entries.join("\n") + "\n";
}

/** 为 CLI 与 Desktop 提供同一套宿主授权路径规则与记录验证。 */
export class WorkspaceSshAuthorization {
  /** 宿主数据根的真实路径，避免 /var 等路径别名导致授权目录比较漂移。 */
  private readonly root_path: string;

  constructor(
    root_path: string,
    private readonly workspaces: WorkspaceRepository,
  ) {
    this.root_path = realpathSync(root_path);
  }

  /** 只读检查记录及文件身份，不触发签名或登录。 */
  async status(workspace_id: string): Promise<LocalWorkspaceSshStatus> {
    const config = this.require_workspace(workspace_id);
    if (!config.ssh) return { state: "disabled", authorization: null, reason: "SSH identity is not authorized" };
    try {
      await this.validate_record(config, config.ssh);
      return { state: "ready", authorization: config.ssh, reason: "Host-authorized SSH endpoint is available" };
    } catch (error) {
      return {
        state: "needs_authorization", authorization: config.ssh,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 装配运行实例前读取授权；失效时报错，绝不退回进程默认身份。 */
  async resolve_access(workspace_id: string): Promise<Pick<LocalWorkspaceSshAuthorization, "socket_path" | "known_hosts_path"> | undefined> {
    const config = this.require_workspace(workspace_id);
    if (!config.ssh) return undefined;
    await this.validate_record(config, config.ssh);
    return { socket_path: config.ssh.socket_path, known_hosts_path: config.ssh.known_hosts_path };
  }

  /** 在停止旧实例前预检输入，避免错误参数导致无谓中断。 */
  async validate_input(workspace_id: string, input: LocalWorkspaceSshInput): Promise<void> {
    const config = this.require_workspace(workspace_id);
    await this.socket_identity(input.socket_path);
    normalize_known_hosts(input.known_hosts);
    const directory = this.authorization_directory(config);
    if (contains_path(await realpath(config.workspace_path), directory)) {
      throw new Error("SSH authorization storage cannot be inside the writable project");
    }
  }

  /** 在 City 独占替换中应用授权/撤销；清理失败不写记录，创建失败保持门禁关闭。 */
  async change(
    workspace_id: string,
    input: LocalWorkspaceSshInput | null,
    runtime: Pick<CityWorkspaces, "replace">,
    create: (config: LocalWorkspaceConfig) => Promise<WorkspaceRuntime>,
  ): Promise<LocalWorkspaceConfig> {
    this.require_workspace(workspace_id);
    // 快照用户提交的数据，避免排队过程中调用方修改授权目标。
    const requested = input ? { socket_path: input.socket_path, known_hosts: input.known_hosts } : null;
    if (requested) await this.validate_input(workspace_id, requested);
    let updated: LocalWorkspaceConfig | undefined;
    await runtime.replace(workspace_id, async () => {
      updated = requested
        ? await this.commit_authorization(workspace_id, requested)
        : this.revoke(workspace_id);
      return await create(updated);
    });
    if (!updated) throw new Error("Workspace authorization change did not complete");
    return updated;
  }

  /** 仅在应用层已停止旧实例并阻止并发创建后调用；先落盘，再更新数据库。 */
  async commit_authorization(workspace_id: string, input: LocalWorkspaceSshInput): Promise<LocalWorkspaceConfig> {
    await this.validate_input(workspace_id, input);
    const config = this.require_workspace(workspace_id);
    const identity = await this.socket_identity(input.socket_path);
    const directory = this.authorization_directory(config);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const directory_info = await lstat(directory);
    if (await realpath(directory) !== directory || !directory_info.isDirectory()
      || (directory_info.mode & 0o077) !== 0
      || (process.getuid && directory_info.uid !== process.getuid())) {
      throw new Error("SSH authorization directory must be a private host-owned directory (0700)");
    }
    const known_hosts_path = path.join(directory, `known_hosts-${randomUUID()}`);
    await writeFile(known_hosts_path, normalize_known_hosts(input.known_hosts), { flag: "wx", mode: 0o600 });
    try {
      return this.workspaces.update_ssh(workspace_id, {
        ...identity, known_hosts_path, authorized_at: new Date().toISOString(),
      });
    } catch (error) {
      await rm(known_hosts_path, { force: true });
      throw error;
    }
  }

  /** 仅在旧运行实例已清理后撤销；不删除旧信任文件，以免掩盖仍被引用的资源。 */
  revoke(workspace_id: string): LocalWorkspaceConfig {
    return this.workspaces.update_ssh(workspace_id, null);
  }

  /** 固定存入宿主安全目录，不使用命令提供的路径或 Workspace runtime。 */
  private authorization_directory(config: LocalWorkspaceConfig): string {
    return path.join(path.resolve(this.root_path), "security", "workspace-ssh", config.workspace_id);
  }

  /** 检查精确路径和 socket 设备、inode，端点被重建时必须重新授权。 */
  private async socket_identity(input: string): Promise<Pick<LocalWorkspaceSshAuthorization, "socket_path" | "socket_device" | "socket_inode">> {
    return await read_socket_identity(input);
  }

  /** 验证已保存授权仍指向原端点和专用普通信任文件。 */
  private async validate_record(config: LocalWorkspaceConfig, _authorization: LocalWorkspaceSshAuthorization): Promise<void> {
    await resolve_workspace_ssh_access(this.root_path, config);
  }

  /** 管理操作必须指向已登记的 Workspace。 */
  private require_workspace(workspace_id: string): LocalWorkspaceConfig {
    const config = this.workspaces.get(workspace_id);
    if (!config) throw new Error(`Workspace not found: ${workspace_id}`);
    return config;
  }
}

/** 读取 socket 的固定文件系统身份，不连接或请求签名。 */
async function read_socket_identity(input: string): Promise<Pick<LocalWorkspaceSshAuthorization, "socket_path" | "socket_device" | "socket_inode">> {
    if (!path.isAbsolute(input) || /[\r\n\0\\"%]/.test(input)) throw new Error("Select an absolute SSH socket path without SSH expansion characters");
    const socket_path = await realpath(input);
    const info = await stat(socket_path, { bigint: true });
    if (!info.isSocket()) throw new Error("Selected SSH endpoint is not a Unix socket");
    return { socket_path, socket_device: String(info.dev), socket_inode: String(info.ino) };
  }

/** 应用装配共享的授权解析；只读配置，不需要打开或持有数据库。 */
export async function resolve_workspace_ssh_access(
  root_path: string,
  config: LocalWorkspaceConfig,
): Promise<Pick<LocalWorkspaceSshAuthorization, "socket_path" | "known_hosts_path"> | undefined> {
    const authorization = config.ssh;
    if (!authorization) return undefined;
    const current = await read_socket_identity(authorization.socket_path);
    if (current.socket_path !== authorization.socket_path || current.socket_device !== authorization.socket_device
      || current.socket_inode !== authorization.socket_inode) {
      throw new Error("SSH agent endpoint changed; authorize this Workspace again");
    }
    const trust_info = await lstat(authorization.known_hosts_path);
    if (path.dirname(authorization.known_hosts_path) !== path.join(realpathSync(root_path), "security", "workspace-ssh", config.workspace_id)
      || await realpath(authorization.known_hosts_path) !== authorization.known_hosts_path
      || !trust_info.isFile() || (trust_info.mode & 0o077) !== 0
      || (process.getuid && trust_info.uid !== process.getuid())
      || contains_path(await realpath(config.workspace_path), authorization.known_hosts_path)) {
      throw new Error("Workspace SSH trust file is not a managed regular file");
    }
    normalize_known_hosts(await readFile(authorization.known_hosts_path, "utf8"));
    return { socket_path: authorization.socket_path, known_hosts_path: authorization.known_hosts_path };
}
