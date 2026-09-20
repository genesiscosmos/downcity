/**
 * 单个 Workspace 的 microsandbox 隔离环境。
 *
 * 关键点（中文）
 * - 稳定名称用于跨进程恢复同一个可写 rootfs 与 HOME。
 * - 宿主项目只通过固定 guest `/workspace` bind mount 显式进入 microVM。
 * - 普通 stop 只释放计算资源；reset 才删除持久状态。
 */

import path from "node:path";
import { createHash } from "node:crypto";
import type {
  SandboxProcessRequest,
  ShellProcessResult,
  WorkspaceSandbox,
  WorkspaceSandboxBinding,
  WorkspaceSandboxSnapshot,
} from "@downcity/type/shell";
import { Sandbox, type SandboxConfig } from "microsandbox";
import { MicrosandboxProcessHandle } from "./MicrosandboxProcessHandle.js";

const GUEST_WORKSPACE_PATH = "/workspace";
const LABEL_PROTOCOL = "downcity.protocol";
const LABEL_WORKSPACE_ID = "downcity.workspace-id";
const LABEL_WORKSPACE_PATH = "downcity.workspace-path";
const LABEL_RUNTIME_PATH = "downcity.runtime-path";

/** Microsandbox Workspace 创建参数。 */
export interface MicrosandboxWorkspaceOptions {
  /** Workspace 与宿主运行目录绑定。 */
  binding: WorkspaceSandboxBinding;
  /** microsandbox 数据库中的稳定 Sandbox 名称。 */
  name: string;
  /** 新建 Sandbox 时使用的 OCI 镜像。 */
  image: string;
  /** 新建 Sandbox 时分配的虚拟 CPU 数量。 */
  cpus: number;
  /** 新建 Sandbox 时分配的内存，单位 MiB。 */
  memory_mib: number;
}

/** 判断未知值是否为普通对象。 */
function is_record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 从 microsandbox 配置中读取标签。 */
function read_labels(config: SandboxConfig): Record<string, string> {
  const labels = config.labels;
  if (!is_record(labels)) return {};
  return Object.fromEntries(
    Object.entries(labels).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : []
    ),
  );
}

/** 当前 Workspace 独享的 microsandbox。 */
export class MicrosandboxWorkspace implements WorkspaceSandbox {
  /** Provider 后端稳定标识。 */
  readonly backend = "microsandbox";

  /** Workspace 在 guest 中的固定挂载路径。 */
  readonly workspace_path = GUEST_WORKSPACE_PATH;

  /** Downcity 暴露的稳定 Sandbox 身份。 */
  readonly id: string;

  /** 首次连接或创建的唯一并发流程。 */
  private connect_promise?: Promise<Sandbox>;

  /** 当前进程持有的 Sandbox 句柄。 */
  private sandbox?: Sandbox;

  constructor(private readonly options: MicrosandboxWorkspaceOptions) {
    this.id = options.name;
  }

  /** 在 Workspace Sandbox 内启动命令。 */
  async spawn(request: SandboxProcessRequest): Promise<ShellProcessResult> {
    const sandbox = await this.connect();
    const args = request.login
      ? ["-l", "-c", request.cmd]
      : ["-c", request.cmd];
    const handle = await sandbox.execStreamWith(request.shell_path, (builder) =>
      builder
        .args(args)
        .cwd(request.cwd)
        .envs({ ...request.env })
        .stdinPipe()
        .tty(request.terminal === true)
    );
    if (request.terminal === true) {
      await handle.resize(request.rows || 40, request.cols || 120);
    }
    return {
      child: new MicrosandboxProcessHandle(handle),
      cwd: request.cwd,
      sandbox_id: sandbox.id,
      backend: this.backend,
    };
  }

  /** 返回当前 microVM 生效的隔离事实。 */
  describe(): WorkspaceSandboxSnapshot {
    const workspace_path = path.resolve(this.options.binding.workspace_path);
    return {
      backend: this.backend,
      sandbox_id: this.id,
      workdir: GUEST_WORKSPACE_PATH,
      mounts: [
        {
          host_path: workspace_path,
          sandbox_path: GUEST_WORKSPACE_PATH,
          mode: "rw",
        },
      ],
      network: this.options.binding.network ?? "allow",
      // microVM 只挂载 Workspace，读范围由挂载决定。
      read_scope: "mounts",
      writable_roots: [workspace_path],
      denied_read_paths: [],
      policy_digest: createHash("sha256")
        .update(`${this.id}\0${workspace_path}\0rw`)
        .digest("hex")
        .slice(0, 16),
      // microVM 停止只释放计算资源，文件系统按协议保持，因此恒为持久。
      persistent: true,
    };
  }

  /** 停止 microVM 计算资源但保留可写 rootfs 与 HOME。 */
  async stop(): Promise<void> {
    const sandbox = this.sandbox;
    this.sandbox = undefined;
    this.connect_promise = undefined;
    if (sandbox) await sandbox.stop();
  }

  /** 显式删除当前 Workspace Sandbox 的全部持久状态。 */
  async reset(): Promise<void> {
    const sandbox = await this.connect();
    this.sandbox = undefined;
    this.connect_promise = undefined;
    await sandbox.destroy();
  }

  /** 连接或首次创建稳定命名的 Workspace Sandbox。 */
  private async connect(): Promise<Sandbox> {
    if (this.sandbox) return this.sandbox;
    this.connect_promise ??= this.connect_or_create();
    try {
      this.sandbox = await this.connect_promise;
      return this.sandbox;
    } catch (error) {
      this.connect_promise = undefined;
      throw error;
    }
  }

  /** 创建 builder，并校验已有同名 Sandbox 的绑定没有漂移。 */
  private async connect_or_create(): Promise<Sandbox> {
    const workspace_path = path.resolve(this.options.binding.workspace_path);
    const runtime_path = path.resolve(this.options.binding.runtime_path);
    const sandbox = await Sandbox.builder(this.options.name)
      .image(this.options.image)
      .cpus(this.options.cpus)
      .memory(this.options.memory_mib)
      .workdir(GUEST_WORKSPACE_PATH)
      .shell("/bin/sh")
      .labels({
        [LABEL_PROTOCOL]: "1",
        [LABEL_WORKSPACE_ID]: this.options.binding.workspace_id,
        [LABEL_WORKSPACE_PATH]: workspace_path,
        [LABEL_RUNTIME_PATH]: runtime_path,
      })
      .volume(GUEST_WORKSPACE_PATH, (mount) => mount.bind(workspace_path))
      .connectOrCreate();
    try {
      this.assert_binding(await sandbox.config(), workspace_path, runtime_path);
      return sandbox;
    } catch (error) {
      await sandbox.stop().catch(() => undefined);
      throw error;
    }
  }

  /** 拒绝把路径变化后的 Workspace 静默连接到旧挂载。 */
  private assert_binding(
    config: SandboxConfig,
    workspace_path: string,
    runtime_path: string,
  ): void {
    const labels = read_labels(config);
    const matches = labels[LABEL_PROTOCOL] === "1"
      && labels[LABEL_WORKSPACE_ID] === this.options.binding.workspace_id
      && labels[LABEL_WORKSPACE_PATH] === workspace_path
      && labels[LABEL_RUNTIME_PATH] === runtime_path;
    if (matches) return;
    throw new Error(
      `Microsandbox binding changed for Workspace ${this.options.binding.workspace_id}; `
        + "reset the Workspace Sandbox explicitly before reconnecting",
    );
  }
}
