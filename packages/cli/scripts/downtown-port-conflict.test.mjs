/** 使用真实 TCP 子进程验证端口冲突处理；交互仅替换确认入口，绝不触碰已有服务。 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";

let answer = async () => false;
let prompt_count = 0;
let last_prompt;
mock.module(new URL("../bin/downtown/tui/Prompts.js", import.meta.url).href, {
  namedExports: { confirm: async (input) => {
    prompt_count += 1;
    last_prompt = input;
    return await answer();
  } },
});
const { prepare_local_deployment_port } = await import("../bin/downtown/deploy/runtime/LocalDeploymentPort.js");
const { read_local_port_processes, stop_local_port_processes } = await import("../bin/downtown/deploy/process/LocalPortProcess.js");
const supported = process.platform !== "win32" && spawnSync("lsof", ["-v"]).status === 0;

/** 创建带空格工作目录的独立监听进程，并恢复终端状态和清理子进程。 */
async function with_listener(run, { interactive = true, ignore_term = false, host = "127.0.0.1", port = 0 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "fed port test "));
  const child = spawn(process.execPath, ["-e", `
    const net = require('node:net');
    ${ignore_term ? "process.on('SIGTERM', () => {});" : ""}
    const server = net.createServer();
    server.listen({ port: ${port}, host: ${JSON.stringify(host)}, ipv6Only: true }, () => process.send(server.address().port));
  `], { cwd: directory, stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const descriptors = [process.stdin, process.stdout].map((stream) => Object.getOwnPropertyDescriptor(stream, "isTTY"));
  try {
    const [port] = await once(child, "message");
    for (const stream of [process.stdin, process.stdout]) {
      Object.defineProperty(stream, "isTTY", { value: interactive, configurable: true });
    }
    prompt_count = 0;
    last_prompt = undefined;
    await run({ child, port, directory: await realpath(directory) });
  } finally {
    for (const [index, stream] of [process.stdin, process.stdout].entries()) {
      if (descriptors[index]) Object.defineProperty(stream, "isTTY", descriptors[index]);
      else delete stream.isTTY;
    }
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

test("非交互冲突展示身份，不询问也不停止", { skip: !supported }, async () => {
  await with_listener(async ({ child, port, directory }) => {
    await assert.rejects(prepare_local_deployment_port(port, "127.0.0.1", directory), (error) => {
      assert.match(error.note, new RegExp(`PID ${child.pid}`));
      assert.ok(error.note.includes(directory));
      assert.match(error.note, /Same project/);
      assert.match(error.note, /interactive confirmation/);
      return true;
    });
    assert.equal(prompt_count, 0);
    assert.doesNotThrow(() => process.kill(child.pid, 0));
  }, { interactive: false });
});

test("拒绝和取消都保留监听者，确认默认否", { skip: !supported }, async () => {
  await with_listener(async ({ child, port, directory }) => {
    for (const response of [false, { __clack_cancel: true }]) {
      answer = async () => response;
      await assert.rejects(prepare_local_deployment_port(port, "127.0.0.1", directory), /cancelled/);
      assert.equal(last_prompt.initialValue, false);
      assert.ok(last_prompt.details.includes(directory));
      assert.match(last_prompt.details, new RegExp(`PID ${child.pid}`));
      assert.doesNotThrow(() => process.kill(child.pid, 0));
    }
    assert.equal(prompt_count, 2);
  });
});

test("明确确认后发送 SIGTERM 并等待端口释放", { skip: !supported }, async () => {
  await with_listener(async ({ child, port, directory }) => {
    answer = async () => true;
    await prepare_local_deployment_port(port, "127.0.0.1", directory);
    assert.equal(prompt_count, 1);
    assert.equal(child.signalCode, "SIGTERM");
    // 已释放的端口无需再次确认。
    await prepare_local_deployment_port(port, "127.0.0.1", directory);
    assert.equal(prompt_count, 1);
  });
});

test("确认期间身份变化时拒绝发送信号", { skip: !supported }, async () => {
  await with_listener(async ({ child, port }) => {
    const snapshot = await read_local_port_processes(port, "127.0.0.1");
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0].pid, child.pid);
    await assert.rejects(stop_local_port_processes([
      { ...snapshot[0], identity: "a different process start time" },
    ], port, "127.0.0.1"), /port owner changed/);
    assert.doesNotThrow(() => process.kill(child.pid, 0));
  });
});

for (const other_host of ["::1", "::"]) test(`只停止冲突地址的监听者，保留相同端口的 ${other_host}`, { skip: !supported }, async () => {
  await with_listener(async ({ child, port, directory }) => {
    await with_listener(async ({ child: other }) => {
      answer = async () => true;
      await prepare_local_deployment_port(port, "127.0.0.1", directory);
      assert.equal(child.signalCode, "SIGTERM");
      assert.doesNotThrow(() => process.kill(other.pid, 0));
      assert.ok(!last_prompt.details.includes(`PID ${other.pid}`));
    }, { host: other_host, port });
  });
});

test("确认期间监听者自行退出时直接继续部署", { skip: !supported }, async () => {
  await with_listener(async ({ child, port, directory }) => {
    answer = async () => {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
      return true;
    };
    await prepare_local_deployment_port(port, "127.0.0.1", directory);
    assert.equal(prompt_count, 1);
  });
});

test("监听者忽略 SIGTERM 时超时退出，不强制终止", { skip: !supported }, async () => {
  await with_listener(async ({ child, port, directory }) => {
    answer = async () => true;
    await assert.rejects(prepare_local_deployment_port(port, "127.0.0.1", directory), /not released/);
    assert.doesNotThrow(() => process.kill(child.pid, 0));
  }, { ignore_term: true });
});
