/**
 * Workspace 路径访问的纯判定规则。
 *
 * 关键点（中文）
 * - 只做词法判定，不访问文件系统，因此可以在没有任何真实文件操作时单独调用。
 * - 文件工具与 city tool 的 `sandbox.explain_path` 共用同一份边界规则，避免两处漂移。
 * - 符号链接、真实路径收敛等需要 IO 的判断仍留在 FilePathPolicy，不进入本模块。
 */

import path from "node:path";

/** 单次路径访问判定的机器可读结果码。 */
export type PathAccessVerdictCode = "allowed" | "outside_workspace" | "invalid_path";

/** 单次 Workspace 路径访问判定结果。 */
export interface PathAccessVerdict {
  /** 该路径是否落在当前 Workspace 允许访问的范围内。 */
  readonly allowed: boolean;
  /** 归一化后的绝对路径；路径非法时为空字符串。 */
  readonly resolved_path: string;
  /** 机器可读判定结果码。 */
  readonly code: PathAccessVerdictCode;
  /** 面向模型的一句话解释。 */
  readonly reason: string;
}

/** 判断目标路径是否等于根目录或位于根目录之下。 */
export function is_path_inside_root(root_path: string, target_path: string): boolean {
  const relative_path = path.relative(root_path, target_path);
  return (
    relative_path === "" ||
    (relative_path !== ".." &&
      !relative_path.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative_path))
  );
}

/**
 * 词法判定一次 Workspace 内路径访问。
 *
 * 关键点（中文）
 * - 相对路径基于 Workspace 根目录解析，绝对路径直接归一化。
 * - 判定不含任何 IO，因此文件不存在不会改变边界结论。
 */
export function judge_workspace_path_access(input: {
  /** 当前 Workspace 的宿主根目录。 */
  root_path: string;
  /** 待判定的路径，相对或绝对均可。 */
  target_path: string;
}): PathAccessVerdict {
  const raw_root_path = String(input.root_path || "").trim();
  const raw_target_path = String(input.target_path || "").trim();
  if (!raw_root_path || !raw_target_path || raw_target_path.includes("\0")) {
    return {
      allowed: false,
      resolved_path: "",
      code: "invalid_path",
      reason: "A Workspace root and a non-empty target path are required.",
    };
  }
  const root_path = path.resolve(raw_root_path);
  const target_path = path.resolve(
    path.isAbsolute(raw_target_path)
      ? raw_target_path
      : path.join(root_path, raw_target_path),
  );
  if (is_path_inside_root(root_path, target_path)) {
    return {
      allowed: true,
      resolved_path: target_path,
      code: "allowed",
      reason: `Path is inside the Workspace root: ${root_path}`,
    };
  }
  return {
    allowed: false,
    resolved_path: target_path,
    code: "outside_workspace",
    reason: `Path is outside the Workspace root: ${root_path}`,
  };
}
