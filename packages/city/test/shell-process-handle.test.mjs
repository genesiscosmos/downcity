/**
 * @file Shell pipe 进程句柄终态事件回归测试。
 *
 * 关键点（中文）
 * - 短命令可能在 Shell runtime 注册 on_exit 前已经退出。
 * - process handle 必须缓存并重放终态，不能让 one-shot exec 永久停留在 running。
 * - one-shot pipe 必须能够显式关闭 stdin，让等待 EOF 的进程正常退出。
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";

import { create_pipe_process_handle } from "../bin/shell/index.js";

test("pipe handle 向后注册的 on_exit 重放已发生的 close", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(7)"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const handle = create_pipe_process_handle(child);

  await once(child, "close");

  const exit_code = await new Promise((resolve) => {
    handle.on_exit(resolve);
  });
  assert.equal(exit_code, 7);
});

test("pipe handle 关闭 stdin 后向子进程发送 EOF", async () => {
  const child = spawn(process.execPath, [
    "-e",
    "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('eof'))",
  ], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const handle = create_pipe_process_handle(child);
  let output = "";
  handle.on_data((chunk) => {
    output += String(chunk);
  });

  handle.close_stdin();
  assert.equal(handle.writable, false);

  const exit_code = await new Promise((resolve) => {
    handle.on_exit(resolve);
  });
  assert.equal(exit_code, 0);
  assert.equal(output, "eof");
});
