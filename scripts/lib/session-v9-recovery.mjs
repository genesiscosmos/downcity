/**
 * 显式启用的 v9 历史恢复策略与审计计划。默认迁移不启用；只处理用户已确认的
 * 中断、大小写纠正、失效投递及无法定位来源的已完成账本，不修改原始快照。
 * 每条决定绑定来源摘要，暂存阶段必须重现相同计划，禁止重入时扩大修复范围。
 */
import fs from "node:fs";
import path from "node:path";
import { digest, fail } from "./session-v7-database.mjs";
import { exists, ordinary } from "./session-v8-files.mjs";

export const recovery_policy = "reviewed-interrupt-and-disable-v1";
export const audit_directory = ".session-v9-audit";
const reference_errors = new Set(["session_reference_not_found", "ambiguous_session_reference", "incomplete_session_reference"]);

/** 源数据有歧义只能进入审计，语法、摘要、权限和未完成投递等错误仍然阻塞。 */
export function is_unavailable_reference(error) { return reference_errors.has(error.migration_code ?? error.message); }

/** 按确定顺序保存结构计划；报告不携带正文、工具参数或渠道载荷。 */
export function create_recovery(context, enabled, expected) {
  if (!enabled) return undefined;
  const decisions = new Map();
  const groups = new Map();
  const record = (kind, relative_path, source, details = {}) => {
    const entry = { kind, relative_path, source_sha256: digest(source), ...details };
    const key = digest([kind, relative_path, details.session_key, details.message_id, details.conversation_id, details.member_agent_id]);
    if (decisions.has(key) && digest(decisions.get(key)) !== digest(entry)) fail("recovery_decision_conflict");
    decisions.set(key, entry);
  };
  // 只有目录与 metadata 的大小写差异可纠正；别名必须唯一，不能合并不同群聊。
  const group_root = path.join(context.root_path, "groups");
  if (exists(group_root)) for (const group_name of fs.readdirSync(group_root).sort()) {
    const group_path = path.join(group_root, group_name); ordinary(group_path, true);
    for (const partition of ["sessions", "archived-sessions"]) {
      const area = path.join(group_path, partition); if (!exists(area)) continue; ordinary(area, true);
      const names = fs.readdirSync(area).sort();
      for (const name of names) {
        const directory = path.join(area, name); ordinary(directory, true);
        const canonical = decodeURIComponent(name);
        const meta_path = path.join(directory, "meta.json"); if (!exists(meta_path)) continue; ordinary(meta_path);
        const value = JSON.parse(fs.readFileSync(meta_path, "utf8"));
        if (typeof value.session_id !== "string" || value.group_id !== group_name) fail("group_metadata_invalid");
        if (canonical !== value.session_id && canonical.toLowerCase() !== value.session_id.toLowerCase()) fail("group_metadata_invalid");
        if (names.some(other => other !== name && decodeURIComponent(other).toLowerCase() === canonical.toLowerCase())) fail("group_session_case_conflict");
        for (const alias of [canonical, value.session_id]) {
          const key = JSON.stringify([group_name, alias]);
          if (groups.has(key) && groups.get(key) !== canonical) fail("group_session_case_conflict");
          groups.set(key, canonical);
        }
      }
    }
  }
  return {
    record,
    group_session: (group_id, session_id) => groups.get(JSON.stringify([group_id, session_id])) ?? session_id,
    quarantine: (file_path, raw, reason, visit) => {
      const relative_path = path.relative(context.root_path, file_path);
      record("quarantine_ledger", relative_path, raw, { reason });
      visit(file_path, path.join(context.root_path, audit_directory, context.migration_id, relative_path), raw, raw);
    },
    finish: () => {
      const entries = [...decisions.values()].sort((left, right) => digest(left).localeCompare(digest(right)));
      if (expected && digest(entries) !== digest(expected)) fail("recovery_plan_changed");
      return { policy: recovery_policy, entries };
    },
  };
}

/** Group 来源关系是声明过的协议字段；正文及任意扩展载荷不参与替换。 */
export function recover_group_origin(origin, recovery) {
  if (!recovery || !origin.group_id || !origin.group_session_id) return origin;
  return { ...origin, group_session_id: recovery.group_session(origin.group_id, origin.group_session_id) };
}
