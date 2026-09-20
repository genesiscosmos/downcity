/**
 * 沙箱读写边界判定。
 *
 * 关键点（中文）
 * - 纯词法判定：只读快照事实与路径，不访问文件系统。
 * - 读与写边界不同，必须分开回答，否则只读挂载点上的路径会被误报成可写。
 * - `read_scope` 为 host 时读范围是全宿主减排除列表；为 mounts 时只有挂载目录可读。
 * - 与文件工具的 Workspace 边界不重叠：文件工具只允许 Workspace，这里回答围栏的真实范围。
 */

import type {
  WorkspaceSandboxMount,
  WorkspaceSandboxSnapshot,
} from "@downcity/type/shell";
import type {
  CityToolPathExplanation,
  CityToolPathIntent,
} from "@/city/types/CityPowerData.js";
import { is_path_inside_root } from "@/workspace/file/PathAccessRule.js";

/** 返回包含目标路径的挂载点。 */
export function match_sandbox_mount(input: {
  /** 宿主侧归一化路径。 */
  host_path: string;
  /** 当前隔离环境挂载。 */
  mounts: readonly WorkspaceSandboxMount[];
}): WorkspaceSandboxMount | null {
  return input.mounts.find((mount) => is_path_inside_root(mount.host_path, input.host_path))
    ?? null;
}

/** 按当前生效的隔离边界判定一次路径访问。 */
export function judge_sandbox_boundary(input: {
  /** 请求的访问意图。 */
  intent: CityToolPathIntent;
  /** 归一化后的宿主绝对路径。 */
  resolved_path: string;
  /** 当前语义授权挂载。 */
  mounts: readonly WorkspaceSandboxMount[];
  /** 当前隔离快照；无沙箱时为 null。 */
  snapshot: WorkspaceSandboxSnapshot | null;
}): CityToolPathExplanation {
  const matched_mount = match_sandbox_mount({
    host_path: input.resolved_path,
    mounts: input.mounts,
  });
  const base = {
    resolved_path: input.resolved_path,
    intent: input.intent,
    matched_mount,
  };
  const snapshot = input.snapshot;
  // 关键点（中文）：没有沙箱时 Workspace 边界就是唯一边界，词法已通过即允许。
  if (!snapshot) {
    return {
      ...base,
      allowed: true,
      reason_code: "allowed",
      reason: "Path is inside the Workspace root; no sandbox is bound to this session.",
    };
  }
  if (input.intent === "read") {
    return judge_read({ ...input, base, snapshot });
  }
  return judge_write({ ...input, base, snapshot });
}

/** 判定读访问。 */
function judge_read(input: {
  /** 归一化后的宿主绝对路径。 */
  resolved_path: string;
  /** 当前语义授权挂载。 */
  mounts: readonly WorkspaceSandboxMount[];
  /** 当前隔离快照。 */
  snapshot: WorkspaceSandboxSnapshot;
  /** 已构造的公共返回字段。 */
  base: Pick<CityToolPathExplanation, "resolved_path" | "intent" | "matched_mount">;
}): CityToolPathExplanation {
  if (input.snapshot.read_scope === "host") {
    const denied_path = input.snapshot.denied_read_paths.find((denied) =>
      is_path_inside_root(denied, input.resolved_path)
    );
    if (denied_path) {
      return {
        ...input.base,
        allowed: false,
        reason_code: "read_denied",
        reason:
          `Reading ${input.resolved_path} is denied by the sandbox read exclusion list `
          + `(matched ${denied_path}). This is a protected host path.`,
      };
    }
    return {
      ...input.base,
      allowed: true,
      reason_code: "allowed",
      reason:
        "Reading is allowed: this backend exposes the host filesystem for reading except for "
        + "the protected exclusion list.",
    };
  }
  if (input.base.matched_mount) {
    return {
      ...input.base,
      allowed: true,
      reason_code: "allowed",
      reason:
        `Reading is allowed: the path is inside mounted directory `
        + `${input.base.matched_mount.host_path}.`,
    };
  }
  return {
    ...input.base,
    allowed: false,
    reason_code: "outside_workspace",
    reason:
      "Reading is denied: this backend only exposes explicitly mounted directories, and the "
      + "path is not inside any of them.",
  };
}

/** 判定写访问。 */
function judge_write(input: {
  /** 归一化后的宿主绝对路径。 */
  resolved_path: string;
  /** 当前隔离快照。 */
  snapshot: WorkspaceSandboxSnapshot;
  /** 已构造的公共返回字段。 */
  base: Pick<CityToolPathExplanation, "resolved_path" | "intent" | "matched_mount">;
}): CityToolPathExplanation {
  const writable_root = input.snapshot.writable_roots.find((root) =>
    is_path_inside_root(root, input.resolved_path)
  );
  if (writable_root) {
    return {
      ...input.base,
      allowed: true,
      reason_code: "allowed",
      reason: `Writing is allowed: the path is inside writable root ${writable_root}.`,
    };
  }
  return {
    ...input.base,
    allowed: false,
    reason_code: "write_denied",
    reason:
      `Writing is denied: ${input.resolved_path} is outside every writable root. `
      + `Writable roots are ${input.snapshot.writable_roots.join(", ")}.`,
  };
}
