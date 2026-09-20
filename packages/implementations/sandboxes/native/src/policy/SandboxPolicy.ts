/**
 * 原生隔离策略解析。
 *
 * 关键点（中文）
 * - 语义输入（workspace、runtime、授权目录、网络模式）在这里展开成宿主路径规则。
 * - 展开只有一份实现，seatbelt、bubblewrap 与路径解释共用，避免多处漂移。
 * - 只做词法归一化与合并，不访问文件系统，因此路径不存在不改变围栏结论。
 * - 读隔离模型来自 P0 实测：macOS 上 `(allow file-read* (subpath ...))` 会让 sandbox-exec
 *   SIGABRT，因此读用「全局允许 + 敏感目录 deny 排除」，写用白名单。
 */

import { createHash } from "node:crypto";
import path from "node:path";
import type { WorkspaceSandboxBinding } from "@downcity/type/shell";
import type {
  PathRuleSource,
  ResolvedPathRule,
  ResolvedSandboxPolicy,
} from "../types/SandboxPolicy.js";
import { resolve_protected_paths, resolve_write_roots } from "./PlatformPaths.js";

/** 构造一条路径规则。 */
function create_rule(input: {
  /** 宿主侧路径。 */
  path: string;
  /** 访问能力。 */
  access: "ro" | "rw";
  /** 规则来源。 */
  source: PathRuleSource;
  /** 匹配方式；默认整棵子树。 */
  scope?: "subpath" | "literal";
}): ResolvedPathRule {
  return {
    path: path.resolve(input.path),
    access: input.access,
    scope: input.scope ?? "subpath",
    source: input.source,
  };
}

/**
 * 按路径合并规则。
 *
 * 关键点（中文）
 * - 同一路径取更强的访问能力，避免 workspace 与授权目录重叠时被降级。
 * - 结果按路径长度升序，浅路径先应用，深路径可以覆盖浅路径。
 */
function merge_rules(rules: readonly ResolvedPathRule[]): ResolvedPathRule[] {
  const by_key = new Map<string, ResolvedPathRule>();
  for (const current of rules) {
    const key = `${current.scope}\0${current.path}`;
    const existing = by_key.get(key);
    if (!existing || (existing.access === "ro" && current.access === "rw")) {
      by_key.set(key, current);
    }
  }
  return [...by_key.values()].sort((left, right) => left.path.length - right.path.length);
}

/**
 * 把 Workspace 绑定展开成完整的宿主路径围栏。
 *
 * 关键点（中文）
 * - `env` 只用于展开平台默认路径，不进入围栏判定。
 * - 返回值是纯数据，可以被序列化后写入审计。
 */
export function resolve_sandbox_policy(input: {
  /** Workspace 绑定，提供 workspace、runtime 与显式授权目录。 */
  binding: WorkspaceSandboxBinding;
  /** 目标平台；默认当前进程平台。 */
  platform?: NodeJS.Platform;
  /** 用于展开平台默认路径的环境变量；默认进程环境。 */
  env?: NodeJS.ProcessEnv;
}): ResolvedSandboxPolicy {
  const platform = input.platform || process.platform;
  const env = input.env || process.env;
  const write_rules = merge_rules([
    create_rule({
      path: input.binding.workspace_path,
      access: "rw",
      source: "workspace",
    }),
    create_rule({
      path: input.binding.runtime_path,
      access: "rw",
      source: "runtime",
    }),
    ...(input.binding.granted_mounts || []).map((mount) =>
      create_rule({ path: mount.host_path, access: mount.access, source: "granted" })
    ),
    ...resolve_write_roots({ platform, env }),
  ]);
  const deny_read_rules = merge_rules(
    resolve_protected_paths({ platform, env }).map((protected_path) =>
      create_rule({
        path: protected_path.path,
        access: "ro",
        source: "protected",
        scope: protected_path.scope,
      })
    ),
  );
  const network = input.binding.network ?? "allow";
  return {
    network,
    write_rules,
    deny_read_rules,
    writable_roots: write_rules
      .filter((rule) => rule.access === "rw" && rule.scope === "subpath")
      .map((rule) => rule.path),
    digest: createHash("sha256")
      .update(JSON.stringify({
        network,
        write: write_rules.map((rule) => [rule.path, rule.access, rule.scope]),
        deny_read: deny_read_rules.map((rule) => [rule.path, rule.scope]),
      }))
      .digest("hex")
      .slice(0, 16),
  };
}
