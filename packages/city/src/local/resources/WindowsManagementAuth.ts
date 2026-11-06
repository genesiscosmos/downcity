/**
 * Windows named-pipe 管理认证。系统 PowerShell/.NET 为私有目录设置当前 SID 唯一 ACL，
 * 凭据不进入发现描述或命令行；请求和响应均以随机 nonce + HMAC 认证。
 * named pipe 的默认 ACL 不作为安全保证，其他用户即使连接也无法读管理数据或执行写入。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHmac, timingSafeEqual, createCipheriv, createDecipheriv } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ResourceError } from "./ResourceError.js";

const exec_file = promisify(execFile);

/** ACL 路径作为 base64 数据传入固定脚本，凭据从不进入脚本、命令或日志。 */
async function verify_private_directory(directory: string, initialize: boolean): Promise<void> {
  const encoded_path = Buffer.from(directory, "utf16le").toString("base64");
  const script = `$ErrorActionPreference='Stop'; $p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded_path}')); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; ` + (initialize
    ? `$acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $p -AclObject $acl; ` : "") +
    `$acl=Get-Acl -LiteralPath $p; if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {throw 'Private management directory owner/ACL mismatch'}; $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]); if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) {throw 'Private management ACL is not current-user-only'}`;
  try {
    const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    await exec_file(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024 });
  } catch {
    throw new ResourceError("permission_denied", "Cannot verify the current-user-only Windows management credential ACL", 6);
  }
}

/** 宿主持有 root 租约后准备凭据目录；拒绝 reparse/symlink 路径。 */
export async function create_windows_management_key(root_path: string, instance_id: string): Promise<Buffer> {
  if (!/^[a-zA-Z0-9-]{1,128}$/u.test(instance_id)) throw new ResourceError("host_identity_mismatch", "Invalid management instance ID", 5);
  const directory = path.join(root_path, "runtimes", "city", "management-auth");
  await fs.mkdir(directory, { recursive: true });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ResourceError("permission_denied", "Invalid Windows management credential directory", 6);
  await verify_private_directory(directory, true);
  // root 独占租约证明没有运行宿主；清理崩溃实例凭据，避免无限保留认证材料。
  for (const entry of await fs.readdir(directory)) {
    if (/^[a-zA-Z0-9-]{1,128}\.key$/u.test(entry)) await fs.rm(path.join(directory, entry), { force: true });
  }
  const secret = randomBytes(32);
  await fs.writeFile(path.join(directory, `${instance_id}.key`), secret, { flag: "wx", mode: 0o600 });
  return secret;
}

/** 客户端先确认目录 ACL，再读取该实例的凭据；缺失/不可访问不能回落无认证。 */
export async function read_windows_management_key(root_path: string, instance_id: string): Promise<Buffer> {
  if (!/^[a-zA-Z0-9-]{1,128}$/u.test(instance_id)) throw new ResourceError("host_identity_mismatch", "Invalid management instance ID", 5);
  const directory = path.join(root_path, "runtimes", "city", "management-auth");
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ResourceError("permission_denied", "Invalid Windows management credential directory", 6);
  await verify_private_directory(directory, false);
  const file_path = path.join(directory, `${instance_id}.key`);
  if (!(await fs.lstat(file_path)).isFile()) throw new ResourceError("permission_denied", "Invalid Windows management credential", 6);
  const key = await fs.readFile(file_path);
  if (key.length !== 32) throw new ResourceError("unauthorized", "Invalid management credential length", 6);
  return key;
}

/** HMAC 绑定完整业务 payload 和随机请求 ID，响应也不可由冒名 pipe 伪造。 */
export function encode_management_frame(value: unknown, key?: Buffer): string {
  if (!key) return JSON.stringify(value);
  // 加密使抢占 pipe 名称的伪宿主也无法读取尚未认证的请求正文。
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
  return JSON.stringify({ payload, mac: createHmac("sha256", key).update(payload).digest("hex") });
}

/** 未认证帧在任何业务处理或数据响应前拒绝。 */
export function decode_management_frame(frame: string, key?: Buffer): unknown {
  if (!key) return JSON.parse(frame);
  const value = JSON.parse(frame) as {
    /** 包含 nonce、认证 tag 与密文的 base64 payload，验签前不可解析正文。 */
    payload: string;
    /** SHA-256 HMAC 的固定长度十六进制值。 */
    mac: string;
  };
  if (typeof value.payload !== "string" || !/^[a-f0-9]{64}$/u.test(value.mac)) throw new ResourceError("unauthorized", "Management frame authentication failed", 6);
  const expected = createHmac("sha256", key).update(value.payload).digest();
  if (!timingSafeEqual(expected, Buffer.from(value.mac, "hex"))) throw new ResourceError("unauthorized", "Management frame authentication failed", 6);
  const packed = Buffer.from(value.payload, "base64");
  if (packed.length < 28) throw new ResourceError("unauthorized", "Invalid encrypted management frame", 6);
  const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  try { return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8")); }
  catch { throw new ResourceError("unauthorized", "Management frame decryption failed", 6); }
}
