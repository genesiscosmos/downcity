/**
 * Microsandbox 流式命令句柄适配。
 *
 * 关键点（中文）
 * - microsandbox 通过异步事件流提供进程输出，Downcity Shell 使用回调协议。
 * - 终态和早到输出都会缓存，避免短命令在监听器注册前结束而丢失事件。
 */

import { constants as os_constants } from "node:os";
import type { ShellProcessHandle } from "@downcity/type/shell";
import type { ExecHandle, ExecSink } from "microsandbox";

type TerminalEvent =
  | {
      /** 进程正常进入退出终态。 */
      kind: "exit";
      /** Sandbox 内进程退出码。 */
      exit_code: number;
    }
  | {
      /** 事件流或 stdin 进入错误终态。 */
      kind: "error";
      /** 原始执行错误。 */
      error: Error;
    };

/** 把任意抛出值归一化为 Error。 */
function normalize_error(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** 将 Node signal 名称映射为 Linux guest 使用的 signal number。 */
function resolve_signal_number(signal: NodeJS.Signals | undefined): number {
  const signal_name = signal || "SIGTERM";
  return os_constants.signals[signal_name] || 15;
}

/** Microsandbox ExecHandle 的 Downcity 适配器。 */
export class MicrosandboxProcessHandle implements ShellProcessHandle {
  /** 当前进程在 guest 内的 PID。 */
  pid?: number;

  /** stdin sink 的唯一获取流程。 */
  private readonly stdin_promise: Promise<ExecSink | null>;

  /** 尚未交给首个输出监听器的早到输出。 */
  private readonly pending_data: Array<string | Buffer> = [];

  /** 当前输出监听器集合。 */
  private readonly data_callbacks = new Set<(chunk: string | Buffer) => void>();

  /** 当前退出监听器集合。 */
  private readonly exit_callbacks = new Set<(exit_code: number) => void>();

  /** 当前错误监听器集合。 */
  private readonly error_callbacks = new Set<(error: Error) => void>();

  /** 当前句柄的唯一终态。 */
  private terminal_event: TerminalEvent | null = null;

  /** stdin 是否仍允许写入。 */
  private stdin_writable = true;

  constructor(private readonly handle: ExecHandle) {
    this.stdin_promise = handle.takeStdin();
    void this.pump_events();
  }

  /** 当前 stdin 是否仍允许写入。 */
  get writable(): boolean {
    return this.stdin_writable && !this.terminal_event;
  }

  /** 注册输出监听器，并补发监听前到达的输出。 */
  on_data(callback: (chunk: string | Buffer) => void): void {
    this.data_callbacks.add(callback);
    if (this.pending_data.length === 0) return;
    const pending_data = this.pending_data.splice(0);
    queueMicrotask(() => {
      for (const chunk of pending_data) this.invoke_data_callback(callback, chunk);
    });
  }

  /** 注册退出监听器。 */
  on_exit(callback: (exit_code: number) => void): void {
    if (this.terminal_event?.kind === "exit") {
      const exit_code = this.terminal_event.exit_code;
      queueMicrotask(() => callback(exit_code));
      return;
    }
    if (!this.terminal_event) this.exit_callbacks.add(callback);
  }

  /** 注册错误监听器。 */
  on_error(callback: (error: Error) => void): void {
    if (this.terminal_event?.kind === "error") {
      const error = this.terminal_event.error;
      queueMicrotask(() => callback(error));
      return;
    }
    if (!this.terminal_event) this.error_callbacks.add(callback);
  }

  /** 向 guest 进程 stdin 写入原始字符。 */
  async write(chars: string): Promise<void> {
    if (!this.writable) throw new Error("Microsandbox process stdin is closed");
    const stdin = await this.stdin_promise;
    if (!stdin) throw new Error("Microsandbox process stdin is unavailable");
    await stdin.write(chars);
  }

  /** 关闭非交互进程 stdin。 */
  close_stdin(): void {
    if (!this.stdin_writable) return;
    this.stdin_writable = false;
    void this.stdin_promise
      .then(async (stdin) => await stdin?.close())
      .catch((error) => this.settle({ kind: "error", error: normalize_error(error) }));
  }

  /** 向 guest 进程发送终止信号。 */
  kill(signal?: NodeJS.Signals): void {
    const operation = signal === "SIGKILL"
      ? this.handle.kill()
      : this.handle.signal(resolve_signal_number(signal));
    void operation.catch((error) => {
      this.settle({ kind: "error", error: normalize_error(error) });
    });
  }

  /** 持续消费 microsandbox 事件流。 */
  private async pump_events(): Promise<void> {
    try {
      for await (const event of this.handle) {
        if (event.kind === "started") {
          this.pid = event.pid;
          continue;
        }
        if (event.kind === "stdout" || event.kind === "stderr") {
          this.publish_data(Buffer.from(event.data));
          continue;
        }
        if (event.kind === "exited") {
          this.settle({ kind: "exit", exit_code: event.code });
          return;
        }
      }
      if (!this.terminal_event) {
        this.settle({
          kind: "error",
          error: new Error("Microsandbox process event stream ended before exit"),
        });
      }
    } catch (error) {
      this.settle({ kind: "error", error: normalize_error(error) });
    }
  }

  /** 发布一段进程输出。 */
  private publish_data(chunk: string | Buffer): void {
    if (this.data_callbacks.size === 0) {
      this.pending_data.push(chunk);
      return;
    }
    for (const callback of this.data_callbacks) this.invoke_data_callback(callback, chunk);
  }

  /** 隔离单个输出观察者异常，避免破坏底层事件流。 */
  private invoke_data_callback(
    callback: (chunk: string | Buffer) => void,
    chunk: string | Buffer,
  ): void {
    try {
      callback(chunk);
    } catch {
      // 输出观察者不拥有 guest 进程，失败不能中断事件流。
    }
  }

  /** 提交唯一终态并通知当前监听器。 */
  private settle(event: TerminalEvent): void {
    if (this.terminal_event) return;
    this.terminal_event = event;
    this.stdin_writable = false;
    if (event.kind === "exit") {
      for (const callback of this.exit_callbacks) callback(event.exit_code);
    } else {
      for (const callback of this.error_callbacks) callback(event.error);
    }
    this.exit_callbacks.clear();
    this.error_callbacks.clear();
  }
}
