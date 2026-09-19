/**
 * 沙箱路径翻译。
 *
 * 关键点（中文）
 * - 隔离环境把项目挂载到固定 guest 路径（例如 `/workspace`），模型容易把该路径当成项目路径回传。
 * - 本模块是「沙箱绝对路径 → 宿主路径」的唯一实现，文件工具与 city tool 的 `sandbox.explain_path` 共用。
 * - 只做词法翻译，不访问文件系统；相对路径不在此处理，必须由路径规则按项目根目录解析。
 */

import path from "node:path";
import type { WorkspaceSandboxMount } from "@downcity/type/shell";
import { is_path_inside_root } from "@/workspace/file/PathAccessRule.js";

/** 单次沙箱路径翻译结果。 */
export interface SandboxPathTranslation {
  /** 翻译后的路径；未命中挂载时保持原值。 */
  host_path: string;
  /** 输入是否确实是一条被翻译过的沙箱内路径。 */
  translocated: boolean;
}

/**
 * 把沙箱内绝对路径映射回宿主路径。
 *
 * 关键点（中文）
 * - 相对路径原样返回：它必须由调用方的项目根目录解析，否则会跟着进程 cwd 跑。
 * - 只有落在某个挂载 `sandbox_path` 之下的绝对路径才会被翻译。
 */
export function translate_sandbox_path(input: {
  /** 模型提交的路径。 */
  target_path: string;
  /** 当前隔离环境已成立的挂载；没有沙箱时为空数组。 */
  mounts: readonly WorkspaceSandboxMount[];
}): SandboxPathTranslation {
  const target_path = String(input.target_path || "").trim();
  if (!target_path || !path.isAbsolute(target_path)) {
    return { host_path: target_path, translocated: false };
  }
  const resolved_path = path.resolve(target_path);
  const mount = input.mounts.find((item) =>
    is_path_inside_root(item.sandbox_path, resolved_path)
  );
  if (!mount) return { host_path: resolved_path, translocated: false };
  return {
    host_path: path.join(mount.host_path, path.relative(mount.sandbox_path, resolved_path)),
    translocated: true,
  };
}
