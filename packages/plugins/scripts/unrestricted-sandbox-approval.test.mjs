/**
 * @file 验证 shell unrestricted sandbox 审批运行时。
 *
 * 关键点（中文）
 * - 测试编译后的 bin 输出，避免测试文件进入 package 源码导出面。
 * - 直接驱动 shell runtime state，模拟 UI/Console 收到 approval_id 后批准或拒绝。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  approveShellApproval,
  closeAllShellSessions,
  createShellRuntimeState,
  denyShellApproval,
  execShellCommand,
  readShellSession,
  setShellApprovalModeView,
  startShellSession,
  writeShellSession,
} from "@downcity/workspace/shell/session/ShellActionRuntime.js";

async function create_fixture() {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-unrestricted-"));
  const events = [];
  const run_context = {};
  const context = {
    rootPath: root_path,
    env: {},
    config: { id: "test-agent" },
    paths: {
      getDowncityChannelMetaPath: () => path.join(root_path, ".downcity", "channel", "meta.json"),
    },
    session: {
      get: () => ({
        publishEvent: (event) => {
          events.push(event);
        },
      }),
    },
    shellIntegration: {
      getRunContext: () => run_context,
    },
  };
  return {
    root_path,
    events,
    run_context,
    context,
  };
}

async function wait_for_approval(state) {
  const started_at = Date.now();
  while (Date.now() - started_at < 2000) {
    const approval = Array.from(state.approvals.values())[0];
    if (approval) return approval;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("approval request was not created");
}

test("shell_session unrestricted requires reason", async () => {
  const fixture = await create_fixture();
  const state = createShellRuntimeState({ defaultApprovalTimeoutMs: 500 });
  try {
    await assert.rejects(
      startShellSession(state, fixture.context, {
        cmd: "printf should-not-run",
        cwd: fixture.root_path,
        shell: "/bin/sh",
        login: false,
        sandbox: "unrestricted",
      }),
      /requires a non-empty reason/,
    );
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});

test("shell_session unrestricted denied returns denied tool result without execution", async () => {
  const fixture = await create_fixture();
  const state = createShellRuntimeState({
    defaultApprovalTimeoutMs: 2000,
    defaultInlineWaitMs: 20,
  });
  try {
    const marker_path = path.join(fixture.root_path, "should-not-exist.txt");
    const pending_result = startShellSession(state, fixture.context, {
      cmd: `printf denied > ${JSON.stringify(marker_path)}`,
      cwd: fixture.root_path,
      shell: "/bin/sh",
      login: false,
      sandbox: "unrestricted",
      reason: "测试拒绝 unrestricted sandbox 不会执行命令。",
      ownerContextId: "session_test",
    });

    const approval = await wait_for_approval(state);
    assert.equal(approval.toolName, "shell_session");
    assert.equal(fixture.events[0]?.type, "tool-approval-request");
    assert.equal(fixture.events[0]?.approvalId, approval.approvalId);

    assert.equal(
      await denyShellApproval(state, fixture.context, approval.approvalId),
      true,
    );
    const result = await pending_result;

    assert.equal(result.shell.sandboxMode, "unrestricted");
    assert.equal(result.shell.approvalStatus, "denied");
    assert.equal(result.shell.status, "failed");
    assert.match(result.chunk.output, /User denied unrestricted sandbox execution/);
    await assert.rejects(fs.stat(marker_path), /ENOENT/);
    assert.equal(fixture.events.at(-1)?.type, "tool-approval-result");
    assert.equal(fixture.events.at(-1)?.decision, "denied");
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});

test("shell_exec unrestricted approved executes in unrestricted sandbox", async () => {
  const fixture = await create_fixture();
  const state = createShellRuntimeState({
    defaultApprovalTimeoutMs: 2000,
    defaultInlineWaitMs: 20,
    defaultExecTimeoutMs: 2000,
  });
  try {
    const pending_result = execShellCommand(state, fixture.context, {
      cmd: "printf unrestricted-ok",
      cwd: fixture.root_path,
      shell: "/bin/sh",
      login: false,
      sandbox: "unrestricted",
      reason: "测试批准后执行 unrestricted sandbox 命令。",
      ownerContextId: "session_test",
      timeoutMs: 2000,
    });

    const approval = await wait_for_approval(state);
    assert.equal(approval.toolName, "shell_exec");
    assert.equal(
      await approveShellApproval(state, fixture.context, approval.approvalId),
      true,
    );
    const result = await pending_result;

    assert.equal(result.shell.sandboxed, false);
    assert.equal(result.shell.sandboxMode, "unrestricted");
    assert.equal(result.shell.approvalStatus, "approved");
    assert.equal(result.shell.exitCode, 0);
    assert.equal(result.chunk.output, "unrestricted-ok");
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});

test("closing shell runtime expires a pending approval", async () => {
  const fixture = await create_fixture();
  const state = createShellRuntimeState({ defaultApprovalTimeoutMs: 10_000 });
  try {
    const pending_result = startShellSession(state, fixture.context, {
      cmd: "printf should-not-run",
      cwd: fixture.root_path,
      shell: "/bin/sh",
      login: false,
      sandbox: "unrestricted",
      reason: "测试 runtime 销毁会兑现 pending approval。",
      ownerContextId: "session_dispose",
    });
    await wait_for_approval(state);

    await closeAllShellSessions(state, true);
    const result = await pending_result;

    assert.equal(result.shell.approvalStatus, "expired");
    assert.equal(result.shell.status, "expired");
    assert.equal(state.approvals.size, 0);
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});

test("shell_write unrestricted requires reason", async () => {
  const fixture = await create_fixture();
  const state = createShellRuntimeState({
    defaultApprovalTimeoutMs: 2000,
    defaultInlineWaitMs: 20,
  });
  try {
    const pending_result = startShellSession(state, fixture.context, {
      cmd: "cat",
      cwd: fixture.root_path,
      shell: "/bin/sh",
      login: false,
      sandbox: "unrestricted",
      reason: "测试启动 unrestricted 交互进程。",
      ownerContextId: "session_test",
      inlineWaitMs: 20,
    });
    const start_approval = await wait_for_approval(state);
    await approveShellApproval(state, fixture.context, start_approval.approvalId);
    const started = await pending_result;

    await assert.rejects(
      writeShellSession(state, fixture.context, {
        shellId: started.shell.shellId,
        chars: "should-not-write\n",
      }),
      /requires a non-empty reason/,
    );
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});

test("shell_write unrestricted denied does not write stdin", async () => {
  const fixture = await create_fixture();
  const state = createShellRuntimeState({
    defaultApprovalTimeoutMs: 2000,
    defaultInlineWaitMs: 20,
  });
  try {
    const pending_result = startShellSession(state, fixture.context, {
      cmd: "cat",
      cwd: fixture.root_path,
      shell: "/bin/sh",
      login: false,
      sandbox: "unrestricted",
      reason: "测试启动 unrestricted 交互进程。",
      ownerContextId: "session_test",
      inlineWaitMs: 20,
    });
    const start_approval = await wait_for_approval(state);
    await approveShellApproval(state, fixture.context, start_approval.approvalId);
    const started = await pending_result;

    const pending_write = writeShellSession(state, fixture.context, {
      shellId: started.shell.shellId,
      chars: "denied-write\n",
      reason: "测试拒绝 unrestricted shell_write 不会写入 stdin。",
    });
    const write_approval = await wait_for_approval(state);
    assert.equal(write_approval.toolName, "shell_write");
    assert.equal(write_approval.operation, "write");
    assert.equal(write_approval.inputPreview, "denied-write\n");
    assert.equal(write_approval.inputChars, "denied-write\n".length);
    assert.equal(fixture.events.at(-1)?.type, "tool-approval-request");
    assert.equal(fixture.events.at(-1)?.toolName, "shell_write");
    assert.equal(fixture.events.at(-1)?.operation, "write");

    await denyShellApproval(state, fixture.context, write_approval.approvalId);
    const denied = await pending_write;
    assert.equal(denied.shell.approvalStatus, "denied");
    assert.match(denied.chunk.output, /User denied unrestricted sandbox execution/);

    const read = await readShellSession(state, fixture.context, {
      shellId: started.shell.shellId,
      fromCursor: 0,
      maxOutputTokens: 1000,
    });
    assert.equal(read.chunk.output, "");
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});

test("shell_write unrestricted approved writes stdin", async () => {
  const fixture = await create_fixture();
  const state = createShellRuntimeState({
    defaultApprovalTimeoutMs: 2000,
    defaultInlineWaitMs: 20,
  });
  try {
    const pending_result = startShellSession(state, fixture.context, {
      cmd: "cat",
      cwd: fixture.root_path,
      shell: "/bin/sh",
      login: false,
      sandbox: "unrestricted",
      reason: "测试启动 unrestricted 交互进程。",
      ownerContextId: "session_test",
      inlineWaitMs: 20,
    });
    const start_approval = await wait_for_approval(state);
    await approveShellApproval(state, fixture.context, start_approval.approvalId);
    const started = await pending_result;

    const pending_write = writeShellSession(state, fixture.context, {
      shellId: started.shell.shellId,
      chars: "approved-write\n",
      reason: "测试批准 unrestricted shell_write 后写入 stdin。",
    });
    const write_approval = await wait_for_approval(state);
    assert.equal(write_approval.toolName, "shell_write");
    await approveShellApproval(state, fixture.context, write_approval.approvalId);
    const written = await pending_write;
    assert.equal(written.shell.approvalStatus, "approved");

    const started_at = Date.now();
    let output = "";
    while (Date.now() - started_at < 1000) {
      const read = await readShellSession(state, fixture.context, {
        shellId: started.shell.shellId,
        fromCursor: 0,
        maxOutputTokens: 1000,
      });
      output = read.chunk.output;
      if (output.includes("approved-write")) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(output, /approved-write/);
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});

test("shell_write safe writes without approval", async () => {
  const fixture = await create_fixture();
  const state = createShellRuntimeState({
    defaultApprovalTimeoutMs: 2000,
    defaultInlineWaitMs: 20,
  });
  try {
    const started = await startShellSession(state, fixture.context, {
      cmd: "cat",
      cwd: fixture.root_path,
      shell: "/bin/sh",
      login: false,
      sandbox: "safe",
      inlineWaitMs: 20,
    });
    await writeShellSession(state, fixture.context, {
      shellId: started.shell.shellId,
      chars: "safe-write\n",
    });
    assert.equal(state.approvals.size, 0);

    const started_at = Date.now();
    let output = "";
    while (Date.now() - started_at < 1000) {
      const read = await readShellSession(state, fixture.context, {
        shellId: started.shell.shellId,
        fromCursor: 0,
        maxOutputTokens: 1000,
      });
      output = read.chunk.output;
      if (output.includes("safe-write")) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(output, /safe-write/);
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});

test("shell_exec unrestricted always-allow mode skips pending approval", async () => {
  const fixture = await create_fixture();
  const state = createShellRuntimeState({
    defaultApprovalTimeoutMs: 2000,
    defaultInlineWaitMs: 20,
    defaultExecTimeoutMs: 2000,
  });
  try {
    assert.equal(
      setShellApprovalModeView(state, "session_auto", "always-allow"),
      "always-allow",
    );
    fixture.run_context.sessionId = "session_auto";

    const result = await execShellCommand(state, fixture.context, {
      cmd: "printf auto-approved",
      cwd: fixture.root_path,
      shell: "/bin/sh",
      login: false,
      sandbox: "unrestricted",
      reason: "测试当前 session 自动允许 unrestricted shell_exec。",
      timeoutMs: 2000,
    });

    assert.equal(state.approvals.size, 0);
    assert.equal(fixture.events.length, 0);
    assert.equal(result.shell.sandboxMode, "unrestricted");
    assert.equal(result.shell.approvalStatus, "approved");
    assert.equal(result.chunk.output, "auto-approved");

    const audit_path = path.join(
      fixture.root_path,
      ".downcity",
      "logs",
      "unrestricted-sandbox-audit.jsonl",
    );
    const audit = await fs.readFile(audit_path, "utf-8");
    assert.match(audit, /approval_auto_approved/);
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});

test("shell_write unrestricted always-allow mode is scoped by session", async () => {
  const fixture = await create_fixture();
  const state = createShellRuntimeState({
    defaultApprovalTimeoutMs: 2000,
    defaultInlineWaitMs: 20,
  });
  try {
    setShellApprovalModeView(state, "session_auto", "always-allow");

    const auto_started = await startShellSession(state, fixture.context, {
      cmd: "cat",
      cwd: fixture.root_path,
      shell: "/bin/sh",
      login: false,
      sandbox: "unrestricted",
      reason: "测试当前 session 自动允许 unrestricted shell_session。",
      ownerContextId: "session_auto",
      inlineWaitMs: 20,
    });
    assert.equal(auto_started.shell.approvalStatus, "approved");
    assert.equal(state.approvals.size, 0);

    const written = await writeShellSession(state, fixture.context, {
      shellId: auto_started.shell.shellId,
      chars: "auto-write\n",
      reason: "测试当前 session 自动允许 unrestricted shell_write。",
    });
    assert.equal(written.shell.approvalStatus, "approved");
    assert.equal(state.approvals.size, 0);

    const ask_pending = startShellSession(state, fixture.context, {
      cmd: "printf ask-session",
      cwd: fixture.root_path,
      shell: "/bin/sh",
      login: false,
      sandbox: "unrestricted",
      reason: "测试其它 session 仍然需要审批。",
      ownerContextId: "session_ask",
      inlineWaitMs: 20,
    });
    const approval = await wait_for_approval(state);
    assert.equal(approval.ownerContextId, "session_ask");
    await approveShellApproval(state, fixture.context, approval.approvalId);
    const ask_result = await ask_pending;
    assert.equal(ask_result.shell.approvalStatus, "approved");
  } finally {
    await closeAllShellSessions(state, true);
    await fs.rm(fixture.root_path, { recursive: true, force: true });
  }
});
