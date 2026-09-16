/**
 * city tool `sandbox` namespace。
 *
 * 关键点（中文）
 * - 回答「我在什么隔离环境里跑」「哪些宿主目录被挂进来了」「这个路径为什么被拦」。
 * - `explain_path` 只做词法判定，不读文件也不写文件，因此文件不存在不会改变结论。
 * - 判定规则与文件工具共用 PathAccessRule，边界变化时结论自动跟着变。
 */

import path from "node:path";
import type { WorkspaceSandboxMount } from "@downcity/type/shell";
import { is_path_inside_root, judge_workspace_path_access } from "@/workspace/file/PathAccessRule.js";
import type {
  CityToolActionCall,
  CityToolContext,
  CityToolNamespaceProvider,
} from "@/city/types/CityTool.js";
import type {
  CityToolPathExplanation,
  CityToolSandbox,
} from "@/city/types/CityToolNamespaces.js";
import { assert_known_args, read_required_string_arg } from "@/city/tool/CityToolArgs.js";
import { unexpected_city_tool_action } from "@/city/tool/CityToolErrors.js";

/** 构造当前沙箱事实。 */
function read_sandbox(context: CityToolContext): CityToolSandbox {
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
  snapshot: CityToolContext["sandbox"];
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

/** 判定一个路径是否可访问。 */
function explain_path(call: CityToolActionCall): CityToolPathExplanation {
  assert_known_args({ args: call.args, allowed: ["path"], action: call.action });
  const target_path = read_required_string_arg({
    args: call.args,
    name: "path",
    action: call.action,
  });
  const resolved_path = resolve_host_path({ target_path, snapshot: call.context.sandbox });
  const verdict = judge_workspace_path_access({
    root_path: call.context.workspace_path,
    target_path: resolved_path.host_path,
  });
  const mounts = call.context.sandbox?.mounts ?? [];
  const matched_mount = verdict.allowed
    ? match_mount({ host_path: verdict.resolved_path, mounts })
    : null;
  return {
    allowed: verdict.allowed,
    resolved_path: verdict.resolved_path,
    matched_mount,
    reason_code: verdict.code,
    reason: resolved_path.translocated
      ? `${verdict.reason} The input was a sandbox path and was mapped to the host path first.`
      : verdict.reason,
  };
}

/** 创建 `sandbox` namespace provider。 */
export function create_sandbox_namespace(): CityToolNamespaceProvider {
  return {
    namespace: "sandbox",
    summary: "The isolated environment this session runs in and which host paths are visible.",
    actions: [
      {
        action: "get",
        summary: "Read the sandbox backend, instance, workdir, mounts and persistence.",
        args: [],
        returns:
          "available, backend, sandbox_id, workdir, mounts(host_path, sandbox_path, mode), persistent",
        capability: "read",
        sensitivity: "public",
      },
      {
        action: "list_mounts",
        summary: "List the host directories mounted into the sandbox.",
        args: [],
        returns: "mounts(host_path, sandbox_path, mode)",
        capability: "read",
        sensitivity: "public",
      },
      {
        action: "explain_path",
        summary:
          "Decide whether a path is reachable and why it is blocked. Read-only, no file access.",
        args: [
          {
            name: "path",
            type: "string",
            required: true,
            description: "Path to test, either relative, absolute or a sandbox path.",
          },
        ],
        returns:
          "allowed, resolved_path, matched_mount, reason_code(allowed|outside_workspace|invalid_path), reason",
        capability: "read",
        sensitivity: "public",
      },
    ],
    handle: async (call: CityToolActionCall) => {
      switch (call.action) {
        case "get":
          assert_known_args({ args: call.args, allowed: [], action: call.action });
          return read_sandbox(call.context);
        case "list_mounts":
          assert_known_args({ args: call.args, allowed: [], action: call.action });
          return { mounts: call.context.sandbox?.mounts ?? [] };
        case "explain_path":
          return explain_path(call);
        default:
          throw unexpected_city_tool_action({ namespace: "sandbox", action: call.action });
      }
    },
  };
}
