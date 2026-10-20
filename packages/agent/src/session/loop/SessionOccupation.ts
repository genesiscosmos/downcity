/**
 * Turn 普通输入的占用边界。首个接收请求同步预占用，同对象后续输入共享占用；
 * 只有最后一个关联句柄结束后释放，旧请求的清理不能清除新占用。
 */
import type { SessionPromptActor } from "@/types/sdk/SessionPromptActor.js";
import { same_session_prompt_actor } from "@/types/sdk/SessionPromptActor.js";
import { SessionBusyError } from "@/session/SessionBusyError.js";

/** SessionLoop 独占持有；不拥有执行器或持久化资源。 */
export class SessionOccupation {
  /** 当前普通输入的来源对象。 */
  private owner: SessionPromptActor | null = null;
  /** 当前占用代次，防止迟到清理释放新 Turn。 */
  private generation = Symbol("occupation");
  /** 尚未结束的接收与 Turn 句柄数。 */
  private references = 0;

  /** 返回快照，宿主不能修改内部身份。 */
  get occupied_by(): SessionPromptActor | null {
    return this.owner ? structuredClone(this.owner) : null;
  }

  /** 同步申请接收权限；返回幂等且仅能释放本代次的清理函数。 */
  acquire(actor: SessionPromptActor, session_id: string, turn_id?: string): () => void {
    if (this.owner && !same_session_prompt_actor(this.owner, actor)) {
      throw new SessionBusyError(session_id, this.owner, turn_id);
    }
    if (!this.owner) {
      this.owner = structuredClone(actor);
      this.generation = Symbol("occupation");
    }
    const generation = this.generation;
    this.references += 1;
    let released = false;
    return () => {
      if (released || generation !== this.generation) return;
      released = true;
      this.references -= 1;
      if (this.references === 0) this.owner = null;
    };
  }
}
