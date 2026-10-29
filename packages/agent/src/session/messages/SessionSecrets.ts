/**
 * Session 私密变量的内存存储、单次引用解析与发布前脱敏。
 *
 * 此对象不序列化、不提供模型读取接口。执行器可以获得明文；这里防止已知明文
 * 直接进入模型和普通记录，不承诺阻止任意执行代码编码、拆分或外传秘密。
 */

import type { JsonValue, SessionSecretStreamRedactor } from "@downcity/type";
import { create_secret_stream_redactor } from "./SecretStreamRedactor.js";

const secret_name_pattern = /^[a-z][a-z0-9_]{0,63}$/;
const reference_pattern = /\$\$?\{secrets\.([a-z][a-z0-9_]{0,63})\}/g;
const protected_fields = new Set([
  "action", "cmd", "command", "execute", "execution_source", "source",
  "code", "script", "file_path", "path", "cwd", "tool_name",
]);
const max_secret_count = 64;
const max_secret_chars = 65_536;
const max_expanded_chars = 2_097_152;

/** 构造公开占位符；同名变量只在当前 Session 内有意义。 */
export function secret_reference(name: string): string {
  if (!secret_name_pattern.test(name)) throw new Error("Invalid Session secret name");
  return "${secrets." + name + "}";
}

/** 当前 Session 拥有的私密内存，不与其他 Session、模型或持久化存储共享。 */
export class SessionSecrets {
  /** 当前每个变量的值。 */
  private readonly values = new Map<string, string>();
  /** 保留旧值供仍在运行的调用和后续读回脱敏；销毁时一起释放。 */
  private readonly known_values = new Set<string>();
  /** 后台输出流已捕获的值；跨存储快照共享登记，在清理前封存最后一次提交。 */
  private stream_snapshots = new Set<Set<string>>();

  /** 全量校验后一次提交变量，避免部分校验失败时留下半份配置。 */
  set_many(entries: ReadonlyMap<string, string>): void {
    const names = new Set([...this.values.keys(), ...entries.keys()]);
    if (names.size > max_secret_count) throw new Error("Session secret limit exceeded");
    for (const [name, value] of entries) {
      secret_reference(name);
      if (!value || value.length > max_secret_chars) throw new Error("Invalid Session secret length");
      if (/\$\{secrets\./.test(value)) throw new Error("A secret value cannot contain a reserved Session reference");
    }
    if (this.known_values.size + entries.size > 256) throw new Error("Session secret update limit exceeded");
    for (const [name, value] of entries) {
      this.values.set(name, value);
      this.known_values.add(value);
    }
  }

  /** 为提交准备独立副本；持久化成功后由 Session 原子替换当前存储。 */
  with_values(entries: ReadonlyMap<string, string>): SessionSecrets {
    const staged = new SessionSecrets();
    for (const [name, value] of this.values) staged.values.set(name, value);
    for (const value of this.known_values) staged.known_values.add(value);
    staged.set_many(entries);
    staged.stream_snapshots = this.stream_snapshots;
    return staged;
  }

  /** 创建本次执行的独立 JSON 参数副本；源码和操作控制字段拒绝秘密插值。 */
  resolve(input: JsonValue): JsonValue {
    let expanded_chars = 0;
    const visit = (value: JsonValue, blocked: boolean): JsonValue => {
      if (typeof value === "string") {
        const output = value.replace(reference_pattern, (match, name: string) => {
          if (match.startsWith("$$")) return match.slice(1);
          if (blocked) throw new Error("Secret references are not allowed in code, paths or operation selectors; pass them as input data instead");
          const secret = this.values.get(name);
          if (secret === undefined) throw new Error(`Session secret is not available: ${name}`);
          expanded_chars += secret.length;
          if (expanded_chars > max_expanded_chars) throw new Error("Expanded secret input exceeds the size limit");
          return secret;
        });
        expanded_chars += value.length;
        if (expanded_chars > max_expanded_chars) throw new Error("Expanded tool input exceeds the size limit");
        return output;
      }
      if (Array.isArray(value)) return value.map((item) => visit(item, blocked));
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        visit(item, blocked || protected_fields.has(key)),
      ]));
    };
    return visit(input, false);
  }

  /** 在发布边界递归遮罩值与对象键；保留对象共享关系，避免循环结果无限递归。 */
  redact(value: unknown): unknown {
    if (this.known_values.size === 0) return value;
    const secrets = [...this.known_values].sort((left, right) => right.length - left.length);
    // 一次匹配替换，避免较短秘密再次改写已经插入的遮罩文本。
    const pattern = new RegExp(secrets.map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
    const redact_text = (text: string): string => text.split(/(\$\{secrets\.[a-z][a-z0-9_]{0,63}\})/g)
      .map((part) => /^\$\{secrets\.[a-z][a-z0-9_]{0,63}\}$/.test(part) ? part : part.replace(pattern, "[REDACTED]"))
      .join("");
    const seen = new WeakMap<object, unknown>();
    const visit = (item: unknown): unknown => {
      if (typeof item === "string") return redact_text(item);
      if (!item || typeof item !== "object") return item;
      if (seen.has(item)) return seen.get(item);
      if (item instanceof Error) return { name: redact_text(item.name), message: redact_text(item.message) };
      if (Array.isArray(item)) {
        const result: unknown[] = [];
        seen.set(item, result);
        result.push(...item.map(visit));
        return result;
      }
      const result = Object.create(null) as Record<string, unknown>;
      seen.set(item, result);
      for (const [key, child] of Object.entries(item)) result[redact_text(key)] = visit(child);
      return result;
    };
    return visit(value);
  }

  /** 为独立输出流保留遮罩状态，并在后续块获取新提交的私密值。 */
  create_stream_redactor(read_current: () => SessionSecrets = () => this): SessionSecretStreamRedactor {
    const snapshot = new Set(this.known_values);
    this.stream_snapshots.add(snapshot);
    const stream = create_secret_stream_redactor(() => {
      for (const value of read_current().known_values) snapshot.add(value);
      return [...snapshot];
    });
    return {
      write: (chunk) => stream.write(chunk),
      end: () => {
        try { return stream.end(); }
        finally { this.stream_snapshots.delete(snapshot); snapshot.clear(); }
      },
    };
  }

  /** 在 Session 释放时清除私密引用；不声称 JavaScript 堆内存能可靠清零。 */
  clear(): void {
    for (const snapshot of this.stream_snapshots) {
      for (const value of this.known_values) snapshot.add(value);
    }
    this.values.clear();
    this.known_values.clear();
  }
}
