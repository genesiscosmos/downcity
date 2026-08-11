/**
 * @file 验证模型可见 shell 工具与 PTY session 行为。
 *
 * 关键点（中文）
 * - `shell_exec` 保持非交互 pipe 语义。
 * - `shell_session` 的底层 start 使用 PTY，让交互式程序能检测到 TTY。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Shell } from "@downcity/shell";
import { test_sandbox } from "./TestSandbox.mjs";
import {
  closeAllShellSessions,
  createShellRuntimeState,
  execShellCommand,
  startShellSession,
  waitShellSession,
} from "@downcity/shell/session/ShellActionRuntime.js";

async function create_context() {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-shell-pty-"));
  return {
    root_path,
    context: {
      sandbox: test_sandbox,
      rootPath: root_path,
      env: {},
      config: { id: "test-agent" },
      paths: {
        getDowncityChannelMetaPath: () =>
          path.join(root_path, ".downcity", "channel", "meta.json"),
      },
    },
  };
}

/** 创建一个在收到 kill 后延迟上报 exit 的测试 Sandbox。 */
function create_delayed_exit_sandbox(delay_ms, on_process_exit) {
  return {
    backend: "delayed-exit-test-sandbox",
    async preflight() {
      return { ok: true, platform: process.platform, backend: this.backend, issues: [] };
    },
    async resolve_system_read_only_paths() {
      return [];
    },
    async spawn(request) {
      let exit_callback = () => {};
      let kill_requested = false;
      return {
        child: {
          writable: true,
          onData() {},
          onExit(callback) {
            exit_callback = callback;
          },
          onError() {},
          async write() {},
          close_stdin() {},
          kill() {
            if (kill_requested) return;
            kill_requested = true;
            setTimeout(() => {
              on_process_exit();
              exit_callback(-9);
            }, delay_ms);
          },
        },
        cwd: request.cwd,
        sandboxed: true,
        sandbox_mode: "safe",
        backend: this.backend,
        network_mode: request.policy.network_mode,
        sandbox_dir: request.policy.sandbox_dir,
        home_dir: request.policy.home_dir,
        tmp_dir: request.policy.tmp_dir,
        cache_dir: request.policy.cache_dir,
        policy_fingerprint: request.policy.fingerprint,
      };
    },
  };
}

test("Shell only exposes command tools", () => {
  const shell = new Shell({ root_path: process.cwd(), sandbox: test_sandbox });
  assert.deepEqual(Object.keys(shell.tools).sort(), [
    "shell_exec",
    "shell_session",
  ]);
});

test("Shell rejects rebinding to another Workspace", () => {
  const shell = new Shell({ sandbox: test_sandbox });
  shell.bind("/workspace/first");
  shell.bind("/workspace/first");
  assert.throws(
    () => shell.bind("/workspace/second"),
    /already bound to another Workspace/,
  );
});

test("shell_exec defaults to a ten-minute total timeout", () => {
  assert.equal(createShellRuntimeState().options.defaultExecTimeoutMs, 600_000);
});

test("shell_session uses PTY while shell_exec stays non-interactive", async () => {
  const fixture = await create_context();
  const state = createShellRuntimeState({
    defaultInlineWaitMs: 80,
    defaultExecTimeoutMs: 2000,
  });
  try {
    const detect_tty_cmd = "[ -t 1 ] && printf tty || printf notty";
    const exec_result = await execShellCommand(state, fixture.context, {
      cmd: detect_tty_cmd,
      cwd: fixture.root_path,
      shell: "/bin/sh",
      login: false,
      timeoutMs: 2000,
      sandbox: "safe",
    });
    assert.match(exec_result.chunk?.output || "", /notty$/);
    assert.equal(exec_result.shell?.terminal, false);

    const session_result = await startShellSession(state, fixture.context, {
      cmd: detect_tty_cmd,
      cwd: fixture.root_path,
      shell: "/bin/sh",
      login: false,
      inlineWaitMs: 200,
      sandbox: "safe",
    });
    const observed_result = session_result.chunk?.output
      ? session_result
      : await waitShellSession(state, fixture.context, {
          shellId: session_result.shell.shellId,
          afterVersion: session_result.shell.version,
          fromCursor: 0,
          timeoutMs: 1000,
        });
    assert.match(observed_result.chunk?.output || "", /tty/);
    assert.equal(observed_result.shell?.terminal, true);
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});

test("shell_exec honors an explicit short total timeout", async () => {
  const fixture = await create_context();
  const state = createShellRuntimeState({ defaultExecTimeoutMs: 2000 });
  const started_at = Date.now();
  try {
    await assert.rejects(
      execShellCommand(state, fixture.context, {
        cmd: "sleep 2",
        cwd: fixture.root_path,
        shell: "/bin/sh",
        login: false,
        timeoutMs: 80,
        sandbox: "safe",
      }),
      /shell\.exec timed out after 80ms/,
    );
    assert.ok(Date.now() - started_at < 1500);
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});

test("shell_exec timeout waits for the process exit event before returning", async () => {
  const fixture = await create_context();
  let process_exited = false;
  fixture.context.sandbox = create_delayed_exit_sandbox(
    80,
    () => { process_exited = true; },
  );
  const state = createShellRuntimeState({
    defaultInlineWaitMs: 10,
    defaultExecTimeoutMs: 20,
    minWaitMs: 1,
  });
  try {
    await assert.rejects(
      execShellCommand(state, fixture.context, {
        cmd: "delayed-exit",
        cwd: fixture.root_path,
        shell: "/bin/sh",
        login: false,
        timeoutMs: 20,
        sandbox: "safe",
      }),
      /shell\.exec timed out after 20ms/,
    );
    assert.equal(process_exited, true);
    assert.equal([...state.sessions.values()][0]?.snapshot.status, "killed");
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});

test("shell_exec closes stdin so commands waiting for EOF can exit", async () => {
  const fixture = await create_context();
  const state = createShellRuntimeState({ defaultExecTimeoutMs: 2000 });
  fixture.context.approval_gateway = {
    request: async () => ({
      approval_id: "ap_stdin_eof_test",
      requires_user_decision: false,
      decision: Promise.resolve("approved"),
    }),
  };
  try {
    const result = await execShellCommand(state, fixture.context, {
      cmd: "if read line; then printf input; else printf eof; fi",
      cwd: fixture.root_path,
      shell: "/bin/sh",
      login: false,
      timeoutMs: 2000,
      sandbox: "unrestricted",
      reason: "验证 one-shot stdin EOF",
      ownerContextId: "session-stdin-eof",
      turnId: "turn-stdin-eof",
      toolCallId: "call-stdin-eof",
    });
    assert.equal(result.shell.status, "completed");
    assert.equal(result.shell.stdinWritable, false);
    assert.match(result.chunk.output, /eof$/);
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});

test("unrestricted shell without an Approval Gateway is denied before execution", async () => {
  const fixture = await create_context();
  const state = createShellRuntimeState();
  const marker_path = path.join(fixture.root_path, "executed.txt");
  const result = await execShellCommand(state, fixture.context, {
    cmd: `printf executed > ${JSON.stringify(marker_path)}`,
    cwd: fixture.root_path,
    shell: "/bin/sh",
    login: false,
    sandbox: "unrestricted",
    reason: "verify missing gateway denial",
    ownerContextId: "session-1",
    turnId: "turn-1",
    toolCallId: "call-1",
  });
  assert.equal(result.shell.approvalStatus, "denied");
  assert.equal(await fs.stat(marker_path).then(() => true).catch(() => false), false);
  await fs.rm(fixture.root_path, { recursive: true, force: true });
});

test("unrestricted shell waits for the injected Approval Gateway before execution", async () => {
  const fixture = await create_context();
  const state = createShellRuntimeState();
  const marker_path = path.join(fixture.root_path, "approved.txt");
  let resolve_decision;
  const decision = new Promise((resolve) => {
    resolve_decision = resolve;
  });
  let resolve_requested;
  const requested = new Promise((resolve) => {
    resolve_requested = resolve;
  });
  let approval_input;
  fixture.context.approval_gateway = {
    request: async (input) => {
      approval_input = input;
      resolve_requested();
      return {
        approval_id: "ap_gateway_test",
        requires_user_decision: true,
        decision,
      };
    },
  };

  const execution = execShellCommand(state, fixture.context, {
    cmd: `printf approved > ${JSON.stringify(marker_path)}`,
    cwd: fixture.root_path,
    shell: "/bin/sh",
    login: false,
    sandbox: "unrestricted",
    reason: "verify gateway ordering",
    ownerContextId: "session-1",
    turnId: "turn-1",
    toolCallId: "call-1",
  });
  await requested;
  assert.equal(await fs.stat(marker_path).then(() => true).catch(() => false), false);
  assert.equal(approval_input.tool_call_id, "call-1");
  assert.equal(approval_input.command.includes("approved.txt"), true);

  resolve_decision("approved");
  const result = await execution;
  assert.equal(result.shell.approvalStatus, "approved");
  assert.equal(await fs.readFile(marker_path, "utf8"), "approved");
  await closeAllShellSessions(state, true);
  await fs.rm(fixture.root_path, { recursive: true, force: true });
});
