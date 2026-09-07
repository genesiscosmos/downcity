/**
 * microsandbox Provider 的纯契约测试。
 *
 * 这些测试不启动 microVM，只验证稳定身份、输入边界与流式句柄适配。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { MicrosandboxProvider } from "../bin/index.js";
import { MicrosandboxProcessHandle } from "../bin/MicrosandboxProcessHandle.js";

/** 等待当前异步事件流完成一个调度周期。 */
async function flush_events() {
  await new Promise((resolve) => setImmediate(resolve));
}

/** 创建只实现当前测试所需协议的 microsandbox ExecHandle。 */
function create_exec_handle(events) {
  return {
    async takeStdin() {
      return null;
    },
    async kill() {},
    async signal() {},
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}

test("相同 Workspace 与 Shell 运行目录获得稳定 Sandbox 身份", () => {
  const provider = new MicrosandboxProvider();
  const binding = {
    workspace_id: "Docs Project",
    workspace_path: "/projects/docs",
    runtime_path: "/downcity/city-a",
  };

  const first = provider.create_workspace(binding);
  const second = provider.create_workspace({ ...binding });
  const another_runtime = provider.create_workspace({
    ...binding,
    runtime_path: "/downcity/city-b",
  });

  assert.equal(first.id, second.id);
  assert.notEqual(first.id, another_runtime.id);
  assert.match(first.id, /^downcity-docs-project-[a-f0-9]{20}$/);
  assert.equal(first.workspace_path, "/workspace");
});

test("Provider 拒绝不完整的 Workspace 绑定", () => {
  const provider = new MicrosandboxProvider();

  assert.throws(
    () => provider.create_workspace({
      workspace_id: "",
      workspace_path: "/projects/docs",
      runtime_path: "/downcity/city-a",
    }),
    /requires workspace_id, workspace_path and runtime_path/,
  );
});

test("短命令在监听器注册前产生的输出和退出终态不会丢失", async () => {
  const process_handle = new MicrosandboxProcessHandle(create_exec_handle([
    { kind: "started", pid: 42 },
    { kind: "stdout", data: Buffer.from("hello") },
    { kind: "stderr", data: Buffer.from(" world") },
    { kind: "exited", code: 7 },
  ]));

  await flush_events();

  const output = [];
  let exit_code = null;
  process_handle.on_data((chunk) => output.push(chunk.toString()));
  process_handle.on_exit((code) => {
    exit_code = code;
  });
  await flush_events();

  assert.equal(process_handle.pid, 42);
  assert.deepEqual(output, ["hello", " world"]);
  assert.equal(exit_code, 7);
  assert.equal(process_handle.writable, false);
});
