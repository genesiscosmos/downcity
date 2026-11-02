/**
 * Shell终态回投与启动恢复。快照是唯一事实源，只索引待投递标识；不恢复或重跑进程。
 * 宿主处理Session输入，Shell只确认接收回执。生命周期跟随Workspace Shell。
 */
import fs from "fs-extra";
import type { ShellCompletionHandler, ShellRuntimeLogger, ShellSessionSnapshot } from "@downcity/type/shell";
import type { ShellRuntimeState } from "./ShellRuntimeTypes.js";
import { get_shell_root_dir, get_shell_snapshot_path } from "./Paths.js";
import { write_shell_snapshot } from "./ShellSnapshotStorage.js";

/** 每条快照独立投递，一个慢Session不阻塞其他结果。 */
export class ShellCompletionDelivery {
  private handler?: ShellCompletionHandler;
  private readonly pending = new Map<string, number>();
  private readonly active = new Set<string>();
  private readonly controllers = new Set<AbortController>();
  private timer?: ReturnType<typeof setTimeout>;
  private recovery?: Promise<void>;
  private disposed = false;

  constructor(
    private readonly data_path: string,
    private readonly state: ShellRuntimeState,
    private readonly logger?: ShellRuntimeLogger,
  ) {}

  /** 宿主绑定接收器；重复装配不重复扫描历史。 */
  bind(handler: ShellCompletionHandler): void {
    this.handler = handler;
    void this.recover().catch((error: unknown) => this.warn(error));
    this.schedule();
  }

  /** 新进程启动前等待历史扫描，避免把本进程刚启动的执行当成失管。 */
  async recover(): Promise<void> {
    this.recovery ??= this.scan().catch((error: unknown) => { this.recovery = undefined; throw error; });
    await this.recovery;
  }

  /** 终态或自动回投开关变化后，统一检查同一条快照。 */
  notify(shell_id: string): void {
    if (this.disposed) return;
    this.pending.set(shell_id, Date.now());
    this.schedule();
  }

  /** 释放重试，不等待外部模型；已发起接收由Session自身负责停止收口。 */
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.recovery?.catch(() => undefined);
  }

  private async scan(): Promise<void> {
    const root = get_shell_root_dir(this.data_path);
    if (!await fs.pathExists(root)) return;
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (this.disposed) return;
      if (!entry.isDirectory()) continue;
      const file_path = get_shell_snapshot_path(this.data_path, entry.name);
      if (!await fs.pathExists(file_path)) continue;
      try {
        const snapshot = await fs.readJson(file_path) as ShellSessionSnapshot;
        if (snapshot.shell_id !== entry.name) throw new Error("Shell snapshot identity mismatch");
        if ((snapshot.status === "running" || snapshot.status === "starting") && !this.state.sessions.has(snapshot.shell_id)) {
          snapshot.status = "failed";
          snapshot.interruption_reason = "Process supervision was interrupted; actual process state is unknown. The command was not restarted.";
          snapshot.updated_at = Date.now();
          snapshot.version += 1;
          delete snapshot.exit_code;
          await write_shell_snapshot(file_path, snapshot);
        }
        if (this.needs_delivery(snapshot)) this.pending.set(snapshot.shell_id, Date.now());
      } catch (error) { this.warn(error); }
    }
    this.schedule();
  }

  private needs_delivery(snapshot: ShellSessionSnapshot): boolean {
    return snapshot.auto_notify_on_exit && !!snapshot.completion_target && !snapshot.notification_sent
      && snapshot.notification_state !== "discarded" && snapshot.notification_state !== "delivered"
      && snapshot.status !== "starting" && snapshot.status !== "running";
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.disposed || !this.handler) return;
    let next = Infinity;
    for (const [id, at] of this.pending) if (!this.active.has(id)) next = Math.min(next, at);
    if (!Number.isFinite(next)) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const [id, at] of this.pending) {
        if (at > Date.now() || this.active.has(id)) continue;
        this.active.add(id);
        void this.deliver(id).catch((error: unknown) => { this.pending.set(id, Date.now() + 2000); this.warn(error); })
          .finally(() => { this.active.delete(id); this.schedule(); });
      }
      this.schedule();
    }, Math.max(1, next - Date.now()));
    this.timer.unref?.();
  }

  private async deliver(shell_id: string): Promise<void> {
    if (this.disposed || !this.handler) return;
    const file_path = get_shell_snapshot_path(this.data_path, shell_id);
    const runtime = this.state.sessions.get(shell_id);
    const snapshot = runtime?.snapshot ?? await fs.readJson(file_path) as ShellSessionSnapshot;
    if (!this.needs_delivery(snapshot)) { this.pending.delete(shell_id); return; }
    // 重试也先保存真实终态，不能用仅存在内存的状态确认外部接收。
    await write_shell_snapshot(file_path, snapshot);
    if (this.disposed) return;
    const controller = new AbortController();
    this.controllers.add(controller);
    let receipt: "accepted" | "discarded" | "retry";
    try { receipt = await this.handler(structuredClone(snapshot), controller.signal); }
    finally { this.controllers.delete(controller); }
    if (this.disposed) return;
    if (receipt === "retry") { this.pending.set(shell_id, Date.now() + 2000); return; }
    snapshot.notification_state = receipt === "accepted" ? "delivered" : "discarded";
    snapshot.notification_sent = receipt === "accepted";
    await write_shell_snapshot(file_path, snapshot);
    this.pending.delete(shell_id);
  }

  private warn(error: unknown): void {
    this.logger?.warn("Shell completion retained for recovery", { error: String(error) });
  }
}
