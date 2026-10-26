/**
 * 原生隔离策略解析。
 *
 * 关键点（中文）
 * - 语义输入（workspace、runtime、授权目录、网络模式）在这里展开成宿主路径规则。
 * - 展开只有一份实现，seatbelt、bubblewrap 与路径解释共用，避免多处漂移。
 * - 路径按现存祖先解析真实路径，确保符号链接别名不会令权限规则失效。
 * - 保留宿主可读性，read 子树强制只读，deny 子树拒绝读写。
 * - 限制规则优先，不能通过重叠 write 授权重新开放。
 */

import { createHash } from "node:crypto";
import { resolve_policy_path } from "./PolicyPath.js";
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
  access: ResolvedPathRule["access"];
  /** 规则来源。 */
  source: PathRuleSource;
  /** 匹配方式；默认整棵子树。 */
  scope?: "subpath" | "literal";
}): ResolvedPathRule {
  return {
    path: resolve_policy_path(input.path),
    access: input.access,
    scope: input.scope ?? "subpath",
    source: input.source,
  };
}

/**
 * 按路径合并规则。
 *
 * 关键点（中文）
 * - 同一路径按 deny > read > write 合并，显式限制不能被隐式授权放宽。
 * - 结果稳定排序；平台后端先应用写授权，再落实只读与拒绝限制。
 */
function merge_rules(rules: readonly ResolvedPathRule[]): ResolvedPathRule[] {
  const by_key = new Map<string, ResolvedPathRule>();
  const priority = { write: 0, read: 1, deny: 2 };
  for (const current of rules) {
    const key = `${current.scope}\0${current.path}`;
    const existing = by_key.get(key);
    if (!existing || priority[current.access] > priority[existing.access]) {
      by_key.set(key, current);
    }
  }
  return [...by_key.values()].sort((left, right) =>
    left.path.length - right.path.length || left.path.localeCompare(right.path)
  );
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
  const filesystem_rules = merge_rules([
    create_rule({
      path: input.binding.workspace_path,
      access: "write",
      source: "workspace",
    }),
    create_rule({
      path: input.binding.runtime_path,
      access: "write",
      source: "runtime",
    }),
    ...(input.binding.granted_mounts || []).map((mount) =>
      create_rule({ path: mount.host_path, access: mount.access === "rw" ? "write" : "read", source: "granted" })
    ),
    ...resolve_write_roots({ platform, env }).map((rule) => create_rule({ ...rule, access: "write" })),
    ...resolve_protected_paths({ platform, env }).map((protected_path) =>
      create_rule({
        path: protected_path.path,
        access: "deny",
        source: "protected",
        scope: protected_path.scope,
      })
    ),
  ]);
  const network = input.binding.network ?? "allow";
  return {
    network,
    filesystem_rules,
    writable_roots: filesystem_rules
      .filter((rule) => rule.access === "write" && rule.scope === "subpath")
      .map((rule) => rule.path),
    digest: createHash("sha256")
      .update(JSON.stringify({
        network,
        filesystem: filesystem_rules.map((rule) => [rule.path, rule.access, rule.scope]),
      }))
      .digest("hex")
      .slice(0, 16),
  };
}
