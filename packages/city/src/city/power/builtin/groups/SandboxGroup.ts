/**
 * city power `sandbox` 动作组。
 *
 * 关键点（中文）
 * - 回答「我在什么隔离环境里跑」「哪些宿主目录被挂进来了」「这个路径为什么被拦」。
 * - `explain_path` 只做词法判定，不读文件也不写文件，因此文件不存在不会改变结论。
 * - 判定规则与文件工具共用 PathAccessRule，边界变化时结论自动跟着变。
 */

import path from "node:path";
import { z } from "zod";
import type { WorkspaceSandboxMount } from "@downcity/type/shell";
import { is_path_inside_root, judge_workspace_path_access } from "@/workspace/file/PathAccessRule.js";
import type { CityPowerContext } from "@/city/types/CityPowerContext.js";
import type {
  CityToolPathExplanation,
  CityToolSandbox,
} from "@/city/types/CityPowerData.js";
import { CityAction } from "@/city/power/builtin/CityAction.js";
import { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";

/** 读取当前隔离环境的后端、实例、工作目录与持久性。 */
class GetSandboxAction extends CityAction {
  readonly action = "get";
  readonly description = "Read the sandbox backend, instance, workdir, mounts and persistence.";
  readonly returns =
    "available, backend, sandbox_id, workdir, mounts(host_path, sandbox_path, mode), persistent";

  protected async run(
    _args: Record<string, never>,
    context: CityPowerContext,
  ): Promise<CityToolSandbox> {
    const snapshot = context.sandbox;
    if (!snapshot) {
      return {
        available: false,
        backend: null,
        sandbox_id: null,
        workdir: null,
        mounts: [],
        persistent: false,
      };
    }
    return {
      available: true,
      backend: snapshot.backend,
      sandbox_id: snapshot.sandbox_id,
      workdir: snapshot.workdir,
      mounts: snapshot.mounts,
      persistent: snapshot.persistent,
    };
  }
}

/** 列出挂载进隔离环境的宿主目录。 */
class ListMountsAction extends CityAction {
  readonly action = "list_mounts";
  readonly description = "List the host directories mounted into the sandbox.";
  readonly returns = "mounts(host_path, sandbox_path, mode)";

  protected async run(
    _args: Record<string, never>,
    context: CityPowerContext,
  ): Promise<{ mounts: readonly WorkspaceSandboxMount[] }> {
    return { mounts: context.sandbox?.mounts ?? [] };
  }
}

/** `sandbox.explain_path` 的输入。 */
const explain_path_input = z.strictObject({
  /** Path to test, either relative, absolute or a sandbox path. */
  path: z
    .string()
    .trim()
    .min(1)
    .describe("Path to test, either relative, absolute or a sandbox path."),
});

/** 判定一个路径是否可达，并给出原因。 */
class ExplainPathAction extends CityAction<z.infer<typeof explain_path_input>> {
  readonly action = "explain_path";
  readonly description =
    "Decide whether a path is reachable and why it is blocked. Read-only, no file access.";
  readonly returns =
    "allowed, resolved_path, matched_mount, reason_code(allowed|outside_workspace|invalid_path), reason";
  readonly args_schema = explain_path_input;

  protected async run(
    args: z.infer<typeof explain_path_input>,
    context: CityPowerContext,
  ): Promise<CityToolPathExplanation> {
    const resolved = resolve_host_path({ target_path: args.path, snapshot: context.sandbox });
    const verdict = judge_workspace_path_access({
      root_path: context.workspace_path,
      target_path: resolved.host_path,
    });
    return {
      allowed: verdict.allowed,
      resolved_path: verdict.resolved_path,
      matched_mount: verdict.allowed
        ? match_mount({ host_path: verdict.resolved_path, mounts: context.sandbox?.mounts ?? [] })
        : null,
      reason_code: verdict.code,
      reason: resolved.translocated
        ? `${verdict.reason} The input was a sandbox path and was mapped to the host path first.`
        : verdict.reason,
    };
  }
}

/** `sandbox` 动作组。 */
export class SandboxGroup extends CityActionGroup {
  readonly group = "sandbox";
  readonly summary = "The isolated environment this session runs in and which host paths are visible.";
  protected readonly actions = [
    new GetSandboxAction(),
    new ListMountsAction(),
    new ExplainPathAction(),
  ];
}

/**
 * 把沙箱内绝对路径映射回宿主路径。
 *
 * 关键点（中文）
 * - 相对路径不在这里处理：它必须由路径规则按 Workspace 根目录解析，否则会跟着进程 cwd 跑。
 * - 只有宿主绝对路径与沙箱内绝对路径才需要区分。
 */
function resolve_host_path(input: {
  /** 模型提交的路径。 */
  target_path: string;
  /** 当前隔离环境挂载；没有沙箱时为 null。 */
  snapshot: CityPowerContext["sandbox"];
}): { host_path: string; translocated: boolean } {
  const target_path = input.target_path.trim();
  if (!path.isAbsolute(target_path)) return { host_path: target_path, translocated: false };
  const resolved_path = path.resolve(target_path);
  const mount = input.snapshot?.mounts
    .find((item) => is_path_inside_root(item.sandbox_path, resolved_path));
  if (!mount) return { host_path: resolved_path, translocated: false };
  return {
    host_path: path.join(mount.host_path, path.relative(mount.sandbox_path, resolved_path)),
    translocated: true,
  };
}

/** 返回包含目标路径的挂载点。 */
function match_mount(input: {
  /** 宿主侧归一化路径。 */
  host_path: string;
  /** 当前隔离环境挂载。 */
  mounts: readonly WorkspaceSandboxMount[];
}): WorkspaceSandboxMount | null {
  return input.mounts.find((mount) => is_path_inside_root(mount.host_path, input.host_path))
    ?? null;
}
