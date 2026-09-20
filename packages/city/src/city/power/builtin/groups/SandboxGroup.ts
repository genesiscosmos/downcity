/**
 * city power `sandbox` 动作组。
 *
 * 关键点（中文）
 * - 回答「我在什么隔离环境里跑」「哪些宿主目录被显式授权」「这个路径为什么被拦」。
 * - `explain_path` 只做词法判定，不读文件也不写文件，因此文件不存在不会改变结论。
 * - 边界判定与文件工具共用 PathAccessRule，沙箱路径翻译共用 SandboxPathTranslation。
 * - 读与写的真实边界由 SandboxBoundaryJudgement 回答，本模块只负责动作编排与参数校验。
 */

import { z } from "zod";
import type { WorkspaceSandboxMount } from "@downcity/type/shell";
import { judge_workspace_path_access } from "@/workspace/file/PathAccessRule.js";
import { translate_sandbox_path } from "@/workspace/file/SandboxPathTranslation.js";
import type { CityPowerContext } from "@/city/types/CityPowerContext.js";
import type {
  CityToolPathExplanation,
  CityToolSandbox,
} from "@/city/types/CityPowerData.js";
import { CityAction } from "@/city/power/builtin/CityAction.js";
import { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";
import { judge_sandbox_boundary } from "@/city/power/builtin/groups/SandboxBoundaryJudgement.js";

/** 读取当前隔离环境的后端、实例、工作目录与持久性。 */
class GetSandboxAction extends CityAction {
  readonly action = "get";
  readonly description =
    "Read the sandbox backend, instance, workdir, mounts, read scope and writable roots.";
  readonly returns =
    "available, backend, sandbox_id, workdir, mounts(host_path, sandbox_path, mode), network, read_scope, writable_roots, denied_read_paths, policy_digest, persistent";

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
        network: null,
        read_scope: null,
        writable_roots: [],
        denied_read_paths: [],
        policy_digest: null,
        persistent: false,
      };
    }
    return {
      available: true,
      backend: snapshot.backend,
      sandbox_id: snapshot.sandbox_id,
      workdir: snapshot.workdir,
      mounts: snapshot.mounts,
      network: snapshot.network,
      read_scope: snapshot.read_scope,
      writable_roots: snapshot.writable_roots,
      denied_read_paths: snapshot.denied_read_paths,
      policy_digest: snapshot.policy_digest,
      persistent: snapshot.persistent,
    };
  }
}

/** 列出显式授权进隔离环境的宿主目录。 */
class ListMountsAction extends CityAction {
  readonly action = "list_mounts";
  readonly description = "List the host directories explicitly granted to the sandbox.";
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
  /** Access the caller intends to perform. */
  intent: z
    .enum(["read", "write"])
    .optional()
    .default("read")
    .describe("Access the caller intends to perform; defaults to read."),
});

/** 判定一个路径在指定意图下是否可达，并给出原因。 */
class ExplainPathAction extends CityAction<z.infer<typeof explain_path_input>> {
  readonly action = "explain_path";
  readonly description =
    "Decide whether a path is reachable for the given intent and why it is blocked. Read-only, no file access.";
  readonly returns =
    "allowed, resolved_path, intent, matched_mount, reason_code(allowed|outside_workspace|read_denied|write_denied|invalid_path), reason";
  readonly args_schema = explain_path_input;

  protected async run(
    args: z.infer<typeof explain_path_input>,
    context: CityPowerContext,
  ): Promise<CityToolPathExplanation> {
    const mounts = context.sandbox?.mounts ?? [];
    const resolved = translate_sandbox_path({
      target_path: args.path,
      mounts,
    });
    const verdict = judge_workspace_path_access({
      root_path: context.workspace_path,
      target_path: resolved.host_path,
    });
    // 关键点（中文）：Workspace 词法边界是文件工具的可达范围，先回答它；
    // 通过后再按围栏的真实读写边界回答，两者不重叠。
    if (!verdict.allowed) {
      return {
        allowed: false,
        resolved_path: verdict.resolved_path,
        intent: args.intent,
        matched_mount: null,
        reason_code: verdict.code,
        reason: resolved.translocated
          ? `${verdict.reason} The input was a sandbox path and was mapped to the host path first.`
          : verdict.reason,
      };
    }
    const explanation = judge_sandbox_boundary({
      intent: args.intent,
      resolved_path: verdict.resolved_path,
      mounts,
      snapshot: context.sandbox,
    });
    // 关键点（中文）：输入是沙箱内路径时必须告知已做翻译，
    // 否则模型会把「宿主路径可达」误读成「沙箱路径本身可达」。
    return resolved.translocated
      ? {
        ...explanation,
        reason:
          `${explanation.reason} The input was a sandbox path and was mapped to the host path first.`,
      }
      : explanation;
  }
}

/** `sandbox` 动作组。 */
export class SandboxGroup extends CityActionGroup {
  readonly group = "sandbox";
  readonly summary =
    "The isolated environment this session runs in, which host paths are granted, and why a path is blocked.";
  protected readonly actions = [
    new GetSandboxAction(),
    new ListMountsAction(),
    new ExplainPathAction(),
  ];
}
