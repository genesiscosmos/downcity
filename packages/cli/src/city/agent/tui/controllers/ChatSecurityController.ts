/**
 * Chat TUI 当前 Session 的安全设置控制器。
 *
 * 负责串行提交审批模式并刷新远程状态，避免新 Turn 越过尚未完成的配置请求。
 */

import type { SessionApprovalMode } from "@downcity/agent";
import type { AgentChatSecurityControllerOptions } from "@/city/types/AgentChatSecurity.js";

/** 管理当前 RemoteSession 的安全配置事务。 */
export class ChatSecurityController {
  private readonly options: AgentChatSecurityControllerOptions;
  private update_promise: Promise<boolean> | null = null;

  /** @param options 当前 Session 与状态投影回调。 */
  constructor(options: AgentChatSecurityControllerOptions) {
    this.options = options;
  }

  /** 当前是否仍有安全设置请求未完成。 */
  get is_updating(): boolean {
    return this.update_promise !== null;
  }

  /** 等待当前设置请求完成；没有请求时直接成功。 */
  async wait(): Promise<boolean> {
    return this.update_promise ? await this.update_promise : true;
  }

  /** 启动单一审批模式更新任务。 */
  apply(mode: SessionApprovalMode): void {
    if (mode === this.options.get_approval_mode() || this.update_promise) return;
    const update_promise = this.update(mode);
    this.update_promise = update_promise;
    void update_promise.finally(() => {
      if (this.update_promise === update_promise) this.update_promise = null;
    });
  }

  /** 刷新当前 Session 状态。 */
  async refresh(): Promise<boolean> {
    try {
      const session = this.options.get_session();
      if (!session) return false;
      const status = await session.status();
      if (status.session_id !== this.options.get_session_id()) return false;
      this.options.on_status({
        is_executing: status.state === "running",
        security: status.security,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** 提交审批模式并读取服务端确认状态。 */
  private async update(mode: SessionApprovalMode): Promise<boolean> {
    try {
      const session = this.options.get_session();
      if (!session) return false;
      await session.set({ security: { approval_mode: mode } });
      return await this.refresh();
    } catch (error) {
      this.options.on_error(
        `Failed to update security policy: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
