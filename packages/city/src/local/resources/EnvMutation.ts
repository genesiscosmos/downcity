/** Env 单键变更保留其他注释、空白和声明；调用方负责 root/Workspace 事务与写入。 */

/** 编码沿用 Env 文件规则，避免业务 key 修改顺手重写其他配置。 */
function format_env_value(value: string): string {
  if (!value) return "";
  if (/^[A-Za-z0-9_./:@+-]+$/u.test(value)) return value;
  return `"${value.replace(/\\/gu, "\\\\").replace(/\n/gu, "\\n").replace(/\r/gu, "\\r").replace(/\t/gu, "\\t").replace(/"/gu, "\\\"")}"`;
}

/** undefined 删除目标；设置时消除该 key 的重复声明，其他行原样保留。 */
export function mutate_env_text(raw: string, key: string, value?: string): string {
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`, "u");
  const lines = raw.split(/\r?\n/u);
  let replaced = false;
  const next: string[] = [];
  for (const line of lines) {
    if (!matcher.test(line)) { next.push(line); continue; }
    if (value !== undefined && !replaced) next.push(`${key}=${format_env_value(value)}`);
    replaced = true;
  }
  if (value !== undefined && !replaced) {
    while (next.at(-1) === "") next.pop();
    if (next.length) next.push("");
    next.push(`${key}=${format_env_value(value)}`);
  }
  const text = next.join("\n").replace(/\n+$/u, "");
  return text ? `${text}\n` : "";
}
