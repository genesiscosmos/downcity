/**
 * 单个 Workspace 的原生 OS 隔离环境。
 *
 * 关键点（中文）
 * - 不改变路径：宿主 Workspace 路径在围栏内外保持一致，因此不存在 guest 路径翻译。
 * - 不复制 HOME、不合成凭证：宿主工具链与 git/ssh 配置直接沿用。
 * - `stop()` 是空操作：没有需要停止的持久计算资源。
 * - `reset()` 只丢弃 Downcity 自己的运行记录目录，宿主项目文件不受影响。
 */

import { rm } from "node:fs/promises";
import path from "node:path";
import type {
  SandboxDenialExplanation,
  SandboxProcessLauncher,
  SandboxProcessRequest,
  ShellProcessResult,
  WorkspaceSandbox,
  WorkspaceSandboxBinding,
  WorkspaceSandboxSnapshot,
} from "@downcity/type/shell";
import { build_shell_command_invocation } from "./command/ShellCommandModel.js";
import { explain_sandbox_denial } from "./policy/DenialExplainer.js";
import { wrap_sandbox_invocation } from "./policy/Wrapper.js";
import type { ResolvedSandboxPolicy } from "./types/SandboxPolicy.js";

/** 原生 Workspace Sandbox 创建参数。 */
export interface NativeWorkspaceSandboxOptions {
  /** Workspace 与宿主运行目录绑定。 */
  binding: WorkspaceSandboxBinding;
  /** 已解析的围栏策略。 */
  policy: ResolvedSandboxPolicy;
}

/** 当前 Workspace 独享的原生隔离环境。 */
export class NativeWorkspaceSandbox implements WorkspaceSandbox {
  /** Provider 后端稳定标识。 */
  readonly backend = "native";

  /** 原生隔离不改变路径，Workspace 根在围栏内外一致。 */
  readonly workspace_path: string;

  /** Downcity 暴露的稳定 Sandbox 身份。 */
  readonly id: string;

  /** 当前生效策略。 */
  private readonly policy: ResolvedSandboxPolicy;

  constructor(private readonly options: NativeWorkspaceSandboxOptions) {
    this.policy = options.policy;
    this.workspace_path = path.resolve(options.binding.workspace_path);
    this.id = `native-${options.binding.workspace_id}`;
  }

  /** 在宿主启动一个受围栏约束的命令。 */
  async spawn(request: SandboxProcessRequest): Promise<ShellProcessResult> {
    const launcher = this.require_launcher();
    const env = Object.fromEntries(
      Object.entries(request.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const wrapped = wrap_sandbox_invocation({
      platform: process.platform,
      policy: this.policy,
      invocation: build_shell_command_invocation({
        shell_path: request.shell_path,
        cmd: request.cmd,
        login: request.login,
      }),
      env: process.env,
    });
    const child = await launcher.launch({
      command: wrapped.command,
      args: wrapped.args,
      cwd: request.cwd,
      env,
      execution_dir: path.join(
        this.options.binding.runtime_path,
        "commands",
        request.execution_id,
      ),
      terminal: request.terminal,
      cols: request.cols,
      rows: request.rows,
    });
    return { child, cwd: request.cwd, backend: this.backend, sandbox_id: this.id };
  }

  /** 返回当前生效的隔离事实。 */
  describe(): WorkspaceSandboxSnapshot {
    return {
      backend: this.backend,
      sandbox_id: this.id,
      workdir: this.workspace_path,
      mounts: [
        {
          host_path: this.workspace_path,
          sandbox_path: this.workspace_path,
          mode: "rw",
        },
        ...(this.options.binding.granted_mounts || []).map((mount) => ({
          host_path: path.resolve(mount.host_path),
          sandbox_path: path.resolve(mount.host_path),
          mode: mount.access,
        })),
      ],
      network: this.policy.network,
      read_scope: "host",
      writable_roots: this.policy.writable_roots,
      denied_read_paths: this.policy.deny_read_rules.map((rule) => rule.path),
      policy_digest: this.policy.digest,
      persistent: true,
    };
  }

  /** 原生隔离没有需要停止的计算资源。 */
  async stop(): Promise<void> {}

  /** 丢弃当前 Workspace 的命令记录目录；宿主项目文件不受影响。 */
  async reset(): Promise<void> {
    await rm(path.join(this.options.binding.runtime_path, "commands"), {
      recursive: true,
      force: true,
    });
  }

  /** 把一次失败输出翻译成可执行的围栏解释。 */
  explain_denial(output: string): SandboxDenialExplanation | null {
    return explain_sandbox_denial({ output, policy: this.policy });
  }

  /** 返回 Shell 注入的宿主进程启动器。 */
  private require_launcher(): SandboxProcessLauncher {
    const launcher = this.options.binding.launcher;
    if (!launcher) {
      throw new Error("Native sandbox requires a process launcher from the host");
    }
    return launcher;
  }
}
