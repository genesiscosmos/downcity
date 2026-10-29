/**
 * Shell 子进程事件绑定辅助。
 *
 * 关键点（中文）
 * - 集中处理 stdout/stderr 追加、process error 与 close 事件。
 * - close 到达时先等待输出写入链 drain，再统一进入终态收口，避免尾部输出丢读。
 */

import { StringDecoder } from "node:string_decoder";
import type { ShellRuntimeState, ShellSessionRuntimeState } from "@/shell/session/ShellRuntimeTypes.js";
import {
  append_session_output,
  finalize_exit,
} from "./ShellActionRuntimeSupport.js";

async function finalize_exit_after_output_drain(
  state: ShellRuntimeState,
  session: ShellSessionRuntimeState,
  exit_code: number,
): Promise<void> {
  // 关键点（中文）
  // - `close` 事件到达时，stdout / stderr 的异步 append 链可能刚刚开始收尾。
  // - 这里先让出一个事件循环 tick，再等待当前 write_chain，可显著降低“终态已到但尾部输出尚未可读”的竞态。
  await new Promise<void>((resolve) => {
    const timer = setImmediate(resolve);
    if (typeof timer.unref === "function") timer.unref();
  });
  await append_session_output(state, session, "", true);
  await session.write_chain.catch(() => undefined);
  await finalize_exit(state, session, exit_code);
}

/**
 * 绑定 shell 子进程事件。
 */
export function attach_shell_process_event_handlers(params: {
  /**
   * 当前 shell runtime 状态。
   */
  state: ShellRuntimeState;
  /**
   * 当前 shell runtime session。
   */
  session: ShellSessionRuntimeState;
}): void {
  const { state, session } = params;
  const { child } = session;
  const decoder = new StringDecoder("utf8");
  let closing = false;
  const finish = (exit_code: number): void => {
    if (closing) return;
    closing = true;
    const tail = decoder.end();
    if (tail) void append_session_output(state, session, tail).catch(() => undefined);
    void finalize_exit_after_output_drain(state, session, exit_code).catch(() => undefined);
  };
  child.on_data((chunk: string | Buffer) => {
    const text = Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk ?? "");
    void append_session_output(state, session, text).catch(() => undefined);
  });
  child.on_error((error: Error) => {
    void append_session_output(state, session, `\n[process error] ${String(error)}\n`).catch(
      () => undefined,
    );
    finish(-1);
  });
  child.on_exit((code: number) => {
    finish(typeof code === "number" ? code : -1);
  });
}
