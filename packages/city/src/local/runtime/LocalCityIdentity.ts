/**
 * 本地 City 的持久来源标识。
 *
 * 标识属于宿主 root，不属于 Workspace、登录账户或进程实例。首次创建通过
 * 完整写入后原子硬链接占位，崩溃不会留下半写内容；并发创建只采用胜出文件。
 * 它只用于请求归因，不是机器凭据，也不参与 root 租约或业务授权。
 */
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/** 读取或首次生成 root 的稳定 City ID；损坏文件须明确修复，禁止静默重新分配身份。 */
export function resolve_local_city_id(root_path: string): string {
  const target = path.join(path.resolve(root_path), "city-id");
  try { return read_city_id(target); }
  catch (error) { if (!has_error_code(error, "ENOENT")) throw error; }
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, `city_${randomUUID()}\n`, "utf8");
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  try {
    try { linkSync(temporary, target); }
    catch (error) { if (!has_error_code(error, "EEXIST")) throw error; }
    return read_city_id(target);
  } finally { unlinkSync(temporary); }
}

/** 文件只允许单个有效标签；不输出损坏文件中的潜在私密内容。 */
function read_city_id(target: string): string {
  const city_id = readFileSync(target, "utf8").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(city_id)) throw new Error("Invalid persisted City ID");
  return city_id;
}

/** 仅根据系统错误码区分首次创建和真正 I/O 故障。 */
function has_error_code(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
