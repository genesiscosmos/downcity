/**
 * 私密文本输出的跨块遮罩。
 *
 * 输出末尾可能是私密值前缀时暂存该尾部，直到下一块或结束；在发布和落盘之前
 * 使用，不能用于事后修复已经发布的内容。每个实例保留观察到的值，避免 Session
 * 清除后后台进程回显旧值。新值只保护提交之后尚未发布的内容。
 */

import type { SessionSecretStreamRedactor } from "@downcity/type";

/** 构造独立流，值来源仅由受信 Session 内部提供，不暴露给工具或模型。 */
export function create_secret_stream_redactor(
  read_values: () => readonly string[],
): SessionSecretStreamRedactor {
  const known = new Set<string>();
  let pending = "";
  let ended = false;
  const drain = (final: boolean): string => {
    for (const value of read_values()) if (value) known.add(value);
    const secrets = [...known].sort((left, right) => right.length - left.length);
    let output = "";
    let index = 0;
    while (index < pending.length) {
      const remaining = pending.slice(index);
      // 等待更长的潜在匹配；不能先发布与短秘密重叠的前缀。
      if (!final && secrets.some((secret) => secret.length > remaining.length && secret.startsWith(remaining))) break;
      const matched = secrets.find((secret) => pending.startsWith(secret, index));
      if (matched) {
        output += "[REDACTED]";
        index += matched.length;
      } else {
        output += pending[index];
        index += 1;
      }
    }
    pending = pending.slice(index);
    return output;
  };
  // Capture existing values even when the owning Session is released before first output.
  for (const value of read_values()) if (value) known.add(value);
  return {
    write(chunk: string): string {
      if (ended) throw new Error("Secret output stream has ended");
      pending += chunk;
      return drain(false);
    },
    end(): string {
      if (ended) return "";
      ended = true;
      const output = drain(true);
      known.clear();
      return output;
    },
  };
}
