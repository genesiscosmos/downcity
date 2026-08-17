/**
 * Shell 进程句柄适配器。
 *
 * 关键点（中文）
 * - Node pipe 子进程与 PTY 子进程的事件/写入 API 不一致。
 * - shell runtime 只需要统一的输出、退出、写入和关闭协议；这里把差异收敛掉。
 */

import { spawn as spawnPty } from "node-pty";
import type { IPty } from "node-pty";
import type { ChildProcess } from "node:child_process";
import type {
  ShellProcessHandle,
} from "@/shell/types/Sandbox.js";

type PipeTerminalEvent =
  | {
      /** 子进程正常进入 close 终态。 */
      kind: "exit";
      /** 子进程退出码；无法取得时统一使用 -1。 */
      exit_code: number;
    }
  | {
      /** 子进程通过 error 事件进入终态。 */
      kind: "error";
      /** 子进程启动或运行错误。 */
      error: Error;
    };

/**
 * 把普通 pipe 子进程包装成 shell process handle。
 */
export function createPipeProcessHandle(
  child: ChildProcess,
): ShellProcessHandle {
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Shell pipe process must expose stdin, stdout, and stderr.");
  }
  const stdin = child.stdin;
  const stdout = child.stdout;
  const stderr = child.stderr;
  stdout.setEncoding("utf8");
  stderr.setEncoding("utf8");

  let stdin_closed = false;
  let terminal_event: PipeTerminalEvent | null = null;
  const exit_callbacks = new Set<(exit_code: number) => void>();
  const error_callbacks = new Set<(error: Error) => void>();

  /**
   * 缓存并分发第一个终态事件。
   *
   * 关键点（中文）
   * - 监听器在 wrapper 创建时立即挂载，避免短命令在 runtime 注册回调前退出。
   * - error 后通常还会出现 close；这里只允许第一个终态触发 Session 收口。
   */
  const settle_terminal_event = (event: PipeTerminalEvent): void => {
    if (terminal_event) return;
    terminal_event = event;
    if (event.kind === "exit") {
      for (const callback of exit_callbacks) callback(event.exit_code);
    } else {
      for (const callback of error_callbacks) callback(event.error);
    }
    exit_callbacks.clear();
    error_callbacks.clear();
  };

  child.once("close", (code) => {
    settle_terminal_event({
      kind: "exit",
      exit_code: typeof code === "number" ? code : -1,
    });
  });
  child.once("error", (error) => {
    settle_terminal_event({ kind: "error", error });
  });

  return {
    pid: child.pid,
    get writable() {
      return !stdin_closed && stdin.writable;
    },
    onData(callback) {
      stdout.on("data", callback);
      stderr.on("data", callback);
    },
    onExit(callback) {
      if (terminal_event?.kind === "exit") {
        const exit_code = terminal_event.exit_code;
        queueMicrotask(() => callback(exit_code));
        return;
      }
      if (!terminal_event) exit_callbacks.add(callback);
    },
    onError(callback) {
      if (terminal_event?.kind === "error") {
        const error = terminal_event.error;
        queueMicrotask(() => callback(error));
        return;
      }
      if (!terminal_event) error_callbacks.add(callback);
    },
    async write(chars) {
      await new Promise<void>((resolve, reject) => {
        stdin.write(chars, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    close_stdin() {
      if (stdin_closed) return;
      stdin_closed = true;
      if (stdin.destroyed || stdin.writableEnded) return;
      stdin.end();
    },
    kill(signal) {
      child.kill(signal);
    },
  };
}

/**
 * 把已经由平台 runtime 创建的 PTY 包装成 shell process handle。
 */
export function createPtyProcessHandle(pty: IPty): ShellProcessHandle {
  let writable = true;
  return {
    pid: pty.pid,
    get writable() {
      return writable;
    },
    onData(callback) {
      pty.onData(callback);
    },
    onExit(callback) {
      pty.onExit((event) => {
        writable = false;
        callback(event.exitCode);
      });
    },
    onError(_callback) {
      // node-pty 将启动失败通过 spawn 抛出；运行期没有独立 error event。
    },
    async write(chars) {
      pty.write(chars);
    },
    kill(signal) {
      writable = false;
      pty.kill(signal);
    },
  };
}

/**
 * 使用 PTY 启动并包装成 shell process handle。
 */
export function spawnPtyProcessHandle(params: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  terminal?: {
    /** PTY 列数。 */
    cols?: number;
    /** PTY 行数。 */
    rows?: number;
  };
}): ShellProcessHandle {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(params.env)) {
    if (typeof value !== "string") continue;
    env[key] = value;
  }
  const pty = spawnPty(params.command, params.args, {
    name: "xterm-256color",
    cwd: params.cwd,
    env,
    cols: params.terminal?.cols || 120,
    rows: params.terminal?.rows || 40,
  });
  return createPtyProcessHandle(pty);
}
