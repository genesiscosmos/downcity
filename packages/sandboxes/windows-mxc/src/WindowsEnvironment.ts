/**
 * Windows MXC 环境变量访问辅助。
 *
 * 关键点（中文）
 * - Windows 环境变量名不区分大小写，但 JavaScript 对象键区分大小写。
 * - GitHub runner 常用 `Path`，而本地进程或策略可能使用 `PATH`。
 * - 所有 Windows sandbox 组件通过这里读取宿主环境，避免各自实现大小写兼容。
 */

/** 按 Windows 语义读取环境变量，不改变原始变量值。 */
export function read_windows_env_value(
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  const direct_value = env[key];
  if (typeof direct_value === "string") return direct_value;

  const normalized_key = key.toLowerCase();
  for (const [candidate_key, candidate_value] of Object.entries(env)) {
    if (candidate_key.toLowerCase() !== normalized_key) continue;
    if (typeof candidate_value === "string") return candidate_value;
  }
  return undefined;
}
