/**
 * Worker内持久化子树归档计划。
 * 首次prepare在短事务内冻结权威目录的后序UUID列表；重入只读取原计划。节点归档、
 * 进度与根完成时刻同事务提交，即使后续进程退出也不会把新活动记录当作旧计划目标。
 */
import type { DatabaseSync } from "node:sqlite";
import { normalize_session_type } from "@downcity/type";
import type { AgentArchivePlan, AgentArchivePlanInput, AgentArchivePlanNode, AgentArchiveNodeCommit } from "@/types/store/AgentArchivePlan.js";
import type { SessionDescriptor } from "@downcity/type";
import type { AgentSessionRecord } from "@/types/store/AgentSessionDatabase.js";
import { AgentSessionDatabase } from "./AgentSessionDatabase.js";
import { storage_digest } from "./AgentSessionCursor.js";
import { decode_session_record } from "./AgentSessionRelations.js";

/** 该引擎只在Agent唯一写连接中运行，不调用执行器或外部I/O。 */
export class AgentArchivePlans {
  constructor(private readonly owner: AgentSessionDatabase) {}

  read(operation_id: string): AgentArchivePlan | null {
    return this.owner.read(database => this.read_unsafe(database, operation_id));
  }

  /** 新计划只接受精确活动根；重入核对永久根身份和分类。 */
  prepare(input: AgentArchivePlanInput): AgentArchivePlan {
    const type = normalize_session_type(input.type);
    this.uuid(input.operation_id);
    const prior = this.read(input.operation_id);
    if (prior) { this.assert_input(prior, input, type); return prior; }
    const receipt_id = storage_digest(["archive_prepare", input.operation_id]);
    // write的receipt与计划UUID分离；回调内的计划是权威，不把全量计划复制到receipt。
    this.owner.write(this.receipt_uuid(receipt_id), { command: "archive_prepare", operation_id: input.operation_id,
      session_id: input.session_id, type }, database => {
      const existing = this.read_unsafe(database, input.operation_id);
      if (existing) { this.assert_input(existing, input, type); return { operation_id: input.operation_id }; }
      const root = database.prepare("SELECT * FROM sessions WHERE archived = 0 AND type = ? AND session_id = ?")
        .get(type, input.session_id) as unknown as AgentSessionRecord | undefined;
      if (!root) throw new Error("session_not_found");
      const rows = database.prepare("SELECT * FROM sessions WHERE archived = 0 AND type = 'work'").all() as unknown as AgentSessionRecord[];
      const children = new Map<string, AgentSessionRecord[]>();
      for (const row of rows) {
        const { parent, parent_session_type } = decode_session_record(row) as SessionDescriptor;
        if (parent?.agent_id !== this.owner.options.agent_id || parent_session_type === undefined) continue;
        const key = JSON.stringify([parent_session_type, parent.session_id]);
        const list = children.get(key) ?? []; list.push(row); children.set(key, list);
      }
      const nodes: AgentArchivePlanNode[] = [];
      const visited = new Set<string>();
      // 显式后序栈避免深层关系耗尽JavaScript调用栈，位置预算在展开时即生效。
      const traversal: Array<readonly [AgentSessionRecord, boolean]> = [[root, false]];
      while (traversal.length) {
        const [row, expanded] = traversal.pop()!;
        if (!expanded) {
          if (visited.has(row.session_id)) throw new Error("session_archive_cycle");
          visited.add(row.session_id);
          if (visited.size > 10_000) throw new Error("session_archive_plan_too_large");
          traversal.push([row, true]);
          const descendants = [...(children.get(JSON.stringify([row.type, row.session_id])) ?? [])].sort((a, b) => a.session_key - b.session_key);
          for (const child of descendants.reverse()) traversal.push([child, false]);
          continue;
        }
        const descriptor = decode_session_record(row) as SessionDescriptor;
        nodes.push({ position: nodes.length + 1, session_id: row.session_id,
          type: row.type, kind: descriptor.kind, workspace_id: row.workspace_id, committed_at: null });
      }
      if (nodes.length > 10_000 || Buffer.byteLength(JSON.stringify(nodes)) > 8 * 1024 * 1024) throw new Error("session_archive_plan_too_large");
      const pending = database.prepare("SELECT 1 FROM archive_operation_nodes WHERE session_id = ? AND committed_at IS NULL LIMIT 1");
      for (const node of nodes) if (pending.get(node.session_id)) throw new Error("session_archive_plan_reserved");
      const created_at = Date.now();
      const fingerprint = this.fingerprint(root.session_id, root.type, nodes);
      database.prepare("INSERT INTO archive_operations(operation_id,root_session_id,type,fingerprint,created_at) VALUES (?,?,?,?,?)")
        .run(input.operation_id, root.session_id, root.type, fingerprint, created_at);
      const insert = database.prepare(`INSERT INTO archive_operation_nodes(operation_id,position,session_id,type,kind,workspace_id)
        VALUES (?,?,?,?,?,?)`);
      for (const node of nodes) insert.run(input.operation_id, node.position, node.session_id, node.type, node.kind, node.workspace_id);
      return { operation_id: input.operation_id };
    });
    const plan = this.read(input.operation_id)!;
    this.assert_input(plan, input, type);
    return plan;
  }

  /** 已提交节点重入不再次归档；待提交节点必须是固定后序的首项。 */
  commit(input: AgentArchiveNodeCommit): AgentArchivePlan {
    this.owner.write(this.receipt_uuid(storage_digest(["archive_node", input.operation_id, input.position])),
      { command: "archive_node", ...input }, database => {
        const plan = this.read_unsafe(database, input.operation_id);
        if (!plan || plan.root_session_id !== input.root_session_id || plan.fingerprint !== input.fingerprint) throw new Error("session_archive_operation_conflict");
        const node = plan.nodes.find(node => node.position === input.position);
        if (!node) throw new Error("session_archive_node_invalid");
        if (node.committed_at !== null) return { operation_id: input.operation_id, position: input.position };
        if (plan.nodes.find(item => item.committed_at === null)?.position !== input.position) throw new Error("session_archive_order_invalid");
        const row = database.prepare("SELECT * FROM sessions WHERE session_id = ?").get(node.session_id) as unknown as AgentSessionRecord | undefined;
        if (!row || row.archived || row.type !== node.type) throw new Error("session_archive_record_changed");
        const committed_at = Date.now();
        database.prepare("UPDATE sessions SET archived = 1, archived_at = ?, revision = revision + 1 WHERE session_id = ? AND archived = 0")
          .run(committed_at, node.session_id);
        database.prepare("UPDATE archive_operation_nodes SET committed_at = ? WHERE operation_id = ? AND position = ? AND committed_at IS NULL")
          .run(committed_at, input.operation_id, input.position);
        if (input.position === plan.nodes.length) database.prepare("UPDATE archive_operations SET completed_at = ? WHERE operation_id = ?")
          .run(committed_at, input.operation_id);
        return { operation_id: input.operation_id, position: input.position };
      });
    const plan = this.read(input.operation_id);
    if (!plan || plan.root_session_id !== input.root_session_id || plan.fingerprint !== input.fingerprint) throw new Error("session_archive_operation_conflict");
    return plan;
  }

  private read_unsafe(database: DatabaseSync, operation_id: string): AgentArchivePlan | null {
    const row = database.prepare("SELECT * FROM archive_operations WHERE operation_id = ?").get(operation_id);
    if (!row) return null;
    const nodes = database.prepare("SELECT position,session_id,type,kind,workspace_id,committed_at FROM archive_operation_nodes WHERE operation_id = ? ORDER BY position")
      .all(operation_id) as unknown as AgentArchivePlanNode[];
    const plan = { ...row, nodes } as unknown as AgentArchivePlan;
    const first_pending = nodes.findIndex(node => node.committed_at === null);
    if (!nodes.length || nodes.some((node, index) => node.position !== index + 1)
      || nodes.at(-1)!.session_id !== plan.root_session_id || nodes.at(-1)!.type !== plan.type
      || (first_pending >= 0 && nodes.some((node, index) => index > first_pending && node.committed_at !== null))
      || (plan.completed_at !== null && (nodes.some(node => node.committed_at === null) || plan.completed_at !== nodes.at(-1)!.committed_at))
      || (plan.completed_at === null && nodes.every(node => node.committed_at !== null))
      || this.fingerprint(plan.root_session_id, plan.type, nodes) !== plan.fingerprint) throw new Error("session_archive_plan_corrupt");
    return plan;
  }
  private fingerprint(root_session_id: string, type: string, nodes: AgentArchivePlanNode[]): string {
    return storage_digest({ root_session_id, type, nodes: nodes.map(({ committed_at: _committed, ...identity }) => identity) });
  }
  private assert_input(plan: AgentArchivePlan, input: AgentArchivePlanInput, type: string): void {
    if (plan.root_session_id !== input.session_id || plan.type !== type) {
      throw new Error("session_archive_operation_conflict");
    }
  }
  private receipt_uuid(hash: string): string { return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`; }
  private uuid(value: string): void { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) throw new Error("session_archive_operation_invalid"); }
}
