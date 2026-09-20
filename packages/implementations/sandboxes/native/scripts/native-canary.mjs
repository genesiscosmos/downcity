/**
 * @file 原生 Provider 真实围栏验证脚本。
 *
 * 关键点（中文）
 * - 调用 NativeSandboxProvider.check()，它会在宿主实跑 canary：允许写入与越界拒绝。
 * - 再以真实 launcher 执行一组命令，验证工具链、DNS、git 与 PTY 在围栏内可用。
 * - 这是临时验证产物，结论进入设计文档后即可删除。
 */

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import {
  NativeSandboxProvider,
  explain_sandbox_denial,
  resolve_sandbox_policy,
} from "../bin/index.js";

const HOME = process.env.HOME;

/**
 * 使用宿主 Node 能力的最小进程启动器。
 *
 * 关键点（中文）：协议要求返回统一 ShellProcessHandle；City 侧由 ShellProcessHandle.ts 提供，
 * 这里为了自包含实现一份等价适配，语义与 City 保持一致（早到输出缓存、终态只提交一次）。
 */
function create_launcher() {
  return {
    async launch(request) {
      return await create_pipe_handle(request);
    },
  };
}

/** 启动一个 pipe 进程并包装成 ShellProcessHandle。 */
async function create_pipe_handle(request) {
  const child = spawn(request.command, [...request.args], {
    cwd: request.cwd,
    stdio: "pipe",
    env: { ...request.env },
  });
  const pending = [];
  const data_callbacks = new Set();
  const exit_callbacks = new Set();
  const error_callbacks = new Set();
  let terminal = null;
  let stdin_closed = false;

  const settle = (event) => {
    if (terminal) return;
    terminal = event;
    if (event.kind === "exit") {
      for (const callback of exit_callbacks) callback(event.exit_code);
    } else {
      for (const callback of error_callbacks) callback(event.error);
    }
    exit_callbacks.clear();
    error_callbacks.clear();
  };

  const publish = (chunk) => {
    if (data_callbacks.size === 0) {
      pending.push(chunk);
      return;
    }
    for (const callback of data_callbacks) callback(chunk);
  };

  child.stdout?.on("data", publish);
  child.stderr?.on("data", publish);
  child.once("close", (code) => settle({ kind: "exit", exit_code: typeof code === "number" ? code : -1 }));
  child.once("error", (error) => settle({ kind: "error", error }));

  return {
    pid: child.pid,
    get writable() {
      return !stdin_closed && Boolean(child.stdin?.writable);
    },
    on_data(callback) {
      data_callbacks.add(callback);
      if (pending.length === 0) return;
      const buffered = pending.splice(0);
      queueMicrotask(() => {
        for (const chunk of buffered) callback(chunk);
      });
    },
    on_exit(callback) {
      if (terminal?.kind === "exit") {
        const exit_code = terminal.exit_code;
        queueMicrotask(() => callback(exit_code));
        return;
      }
      if (!terminal) exit_callbacks.add(callback);
    },
    on_error(callback) {
      if (terminal?.kind === "error") {
        const error = terminal.error;
        queueMicrotask(() => callback(error));
        return;
      }
      if (!terminal) error_callbacks.add(callback);
    },
    async write(chars) {
      await new Promise((resolve) => child.stdin?.write(chars, () => resolve()));
    },
    close_stdin() {
      if (stdin_closed) return;
      stdin_closed = true;
      if (!child.stdin || child.stdin.destroyed || child.stdin.writableEnded) return;
      child.stdin.end();
    },
    kill(signal) {
      child.kill(signal);
    },
  };
}

/** 在围栏内执行一次命令，返回退出码与合并输出。 */
async function run_in_sandbox(sandbox, cmd) {
  const result = await sandbox.spawn({
    execution_id: `canary_${Math.random().toString(36).slice(2, 10)}`,
    cmd,
    cwd: sandbox.workspace_path,
    shell_path: "/bin/sh",
    login: true,
    env: Object.fromEntries(
      Object.entries(process.env).filter((entry) => typeof entry[1] === "string"),
    ),
    terminal: false,
  });
  const chunks = [];
  result.child.on_data((chunk) => chunks.push(String(chunk)));
  const exit_code = await new Promise((resolve) => {
    result.child.on_error(() => resolve(-1));
    result.child.on_exit(resolve);
    result.child.close_stdin?.();
  });
  return { exit_code, output: chunks.join("") };
}

const results = [];

/** 记录一条验证结果。 */
function record(name, expectation, actual, ok, detail) {
  results.push({ name, expectation, actual, ok, detail });
}

async function main() {
  // 1. Provider 自检：内部会实跑允许写入与越界拒绝两组 canary。
  const provider = new NativeSandboxProvider();
  const status = await provider.check();
  record(
    "Provider.check 围栏自检",
    "通过",
    status.ok ? "通过" : `未通过: ${status.issues.map((i) => i.code).join(",")}`,
    status.ok,
    status.issues.map((i) => i.message).join(" | "),
  );

  // 2. 真实命令执行。
  const workspace_path = await mkdtemp(path.join(os.tmpdir(), "downcity-native-"));
  const runtime_path = await mkdtemp(path.join(os.tmpdir(), "downcity-native-rt-"));
  const sandbox = provider.create_workspace({
    workspace_id: "canary",
    workspace_path,
    runtime_path,
    launcher: create_launcher(),
  });

  const inside = await run_in_sandbox(sandbox, "printf ok > ./probe.txt && cat ./probe.txt");
  record("workspace 内写入", "允许", inside.exit_code === 0 ? "允许" : "被拒", inside.exit_code === 0, inside.output.trim().slice(0, 80));

  const outside_target = path.join(HOME, `.downcity-native-canary-${process.pid}`);
  const outside = await run_in_sandbox(sandbox, `printf bad > ${JSON.stringify(outside_target)}`);
  const leaked = await rm(outside_target, { force: true }).then(() => false).catch(() => false);
  record("HOME 根目录写入", "拒绝", outside.exit_code !== 0 ? "拒绝" : "写入成功（围栏失效）", outside.exit_code !== 0, outside.output.trim().slice(0, 80));

  const toolchain = await run_in_sandbox(sandbox, "node -v && pnpm -v && rg --version | head -1 && git --version");
  record("工具链读取", "允许", toolchain.exit_code === 0 ? "允许" : "被拒", toolchain.exit_code === 0, toolchain.output.trim().replaceAll("\n", " | ").slice(0, 120));

  const dns = await run_in_sandbox(sandbox, "python3 -c \"import socket;print(socket.gethostbyname('registry.npmjs.org'))\"");
  record("DNS 解析", "可用", dns.exit_code === 0 ? "可用" : "不可用", dns.exit_code === 0, dns.output.trim().slice(0, 60));

  const https = await run_in_sandbox(sandbox, "curl -sS -o ./out.txt -w '%{http_code}' https://registry.npmjs.org/");
  record("HTTPS 出网", "可用", https.output.trim().endsWith("200") ? "可用" : `返回 ${https.output.trim()}`, https.output.trim().endsWith("200"), "");

  const git_read = await run_in_sandbox(sandbox, `git -C ${JSON.stringify(process.cwd())} log --oneline -1`);
  record("git 读取仓库", "可用", git_read.exit_code === 0 ? "可用" : "不可用", git_read.exit_code === 0, git_read.output.trim().slice(0, 80));

  const ssh_agent = await run_in_sandbox(sandbox, "node -e \"const n=require('net');const s=n.connect(process.env.SSH_AUTH_SOCK);s.on('connect',()=>{console.log('connected');s.end()});s.on('error',e=>console.log('err:'+e.code))\"");
  record("ssh-agent socket", "可用", ssh_agent.output.includes("connected") ? "可用" : "不可用", ssh_agent.output.includes("connected"), ssh_agent.output.trim().slice(0, 60));

  const tmp_write = await run_in_sandbox(sandbox, "printf ok > \"$(node -e 'console.log(require(\"os\").tmpdir())')/dc-native-probe\" && echo wrote");
  record("系统临时目录写入", "允许", tmp_write.exit_code === 0 ? "允许" : "被拒", tmp_write.exit_code === 0, "");

  // 3. 拒绝翻译：把真实失败输出喂给 explain_denial。
  const policy = resolve_sandbox_policy({ binding: { workspace_id: "canary", workspace_path, runtime_path } });
  const explanation = explain_sandbox_denial({ output: outside.output, policy });
  record(
    "拒绝翻译定位被拒路径",
    "定位成功",
    explanation?.path ? "定位成功" : "未定位",
    Boolean(explanation?.path),
    explanation?.path || explanation?.reason || "",
  );

  await rm(workspace_path, { recursive: true, force: true });
  await rm(runtime_path, { recursive: true, force: true });
  await rm(path.join(runtime_path, "commands"), { recursive: true, force: true }).catch(() => undefined);

  const width = 28;
  console.log("");
  console.log("P2 canary · 原生隔离真实围栏");
  console.log(`宿主: ${process.platform} ${os.release()} ${process.arch}`);
  console.log("");
  console.log(`${"项目".padEnd(width)} ${"预期".padEnd(10)} ${"实际".padEnd(20)} 结果`);
  console.log("-".repeat(74));
  for (const item of results) {
    console.log(`${item.name.padEnd(width)} ${item.expectation.padEnd(10)} ${item.actual.padEnd(20)} ${item.ok ? "PASS" : "FAIL"}`);
    if (item.detail) console.log(`${"".padEnd(width)} ${item.detail}`);
  }
  console.log("");
  const failed = results.filter((item) => !item.ok);
  console.log(failed.length === 0
    ? `全部 ${results.length} 项通过`
    : `${failed.length}/${results.length} 项未通过: ${failed.map((item) => item.name).join(", ")}`);
}

await main();
