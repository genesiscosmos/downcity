/** 宿主资源变更串行化、内容 revision 与输入检查；不持有交互或展示逻辑。 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { ResourceError } from "./ResourceError.js";

/** 规范化 JSON 字段顺序，revision 不依赖文件空白或对象插入顺序。 */
function canonical_json(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical_json).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical_json(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** 配置内容摘要；时间戳不作为版本判据。 */
export function resource_revision(value: unknown): string {
  const { created_at: _created, updated_at: _updated, ...content } = value as Record<string, unknown>;
  return `sha256:${createHash("sha256").update(canonical_json(content)).digest("hex")}`;
}

/** 在变更锁内进行条件提交检查。 */
export function assert_resource_revision(current: unknown, expected?: string): void {
  if (expected !== undefined && expected !== resource_revision(current)) throw new ResourceError("revision_conflict", "Resource changed; read its current revision before retrying", 4);
}

/** 单一宿主的短事务协调器；等待 Turn 或用户输入不能占用该锁。 */
export class ResourceCoordinator {
  /** 以 root 内全部配置写串行为起点，避免跨资源引用检查的锁顺序问题。 */
  private tail: Promise<unknown> = Promise.resolve();
  /** 同一配置 action 的下层 config.set 可重入；操作结束后继承上下文也失效。 */
  private readonly ownership = new AsyncLocalStorage<{ /** 当前短事务尚未结束，不能把权限传给后续后台 Timer。 */ active: boolean }>();
  /** 关闭门禁只限制外部提交，已接受事务的嵌套操作仍归原事务所有。 */
  private closing = false;
  /** 已保存但尚未成功应用的 Agent，禁止新执行。 */
  readonly blocked_agents = new Set<string>();
  /** 正在释放或释放失败的 Workspace，懒解析也必须拒绝进入。 */
  readonly blocked_workspaces = new Set<string>();

  /** 调用方必须已经持有进程级 root 写租约。 */
  async mutate<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.ownership.getStore()?.active) return await operation();
    if (this.closing) throw new ResourceError("runtime_closing", "Resource mutations are shutting down", 4);
    const run = async (): Promise<T> => {
      const scope = { active: true };
      return await this.ownership.run(scope, async () => {
        try { return await operation(); } finally { scope.active = false; }
      });
    };
    const result = this.tail.then(run, run);
    this.tail = result.then(() => undefined, () => undefined);
    return await result;
  }

  /** 同步停止接受外部变更；调用方随后关闭入口并等待已接受事务结算。 */
  begin_shutdown(): void {
    this.closing = true;
  }

  /**
   * 等待调用前已接受的事务结算；关闭流程应先调用 begin_shutdown 固定队列。
   * 事务内部等待自身队尾会死锁，因此明确拒绝这种调用，交由外层生命周期所有者排空。
   */
  async drain(): Promise<void> {
    if (this.ownership.getStore()?.active) {
      throw new ResourceError("resource_busy", "Cannot drain resource mutations from inside a mutation", 4);
    }
    await this.tail;
  }

  /** 在宿主懒解析/执行入口共享同一门禁。 */
  assert_available(agent_id?: string, workspace_id?: string): void {
    if (agent_id && this.blocked_agents.has(agent_id)) throw new ResourceError("resource_busy", "Agent configuration must be applied successfully before new execution", 4);
    if (workspace_id && this.blocked_workspaces.has(workspace_id)) throw new ResourceError("resource_busy", "Workspace is being released or its release failed", 4);
  }
}
