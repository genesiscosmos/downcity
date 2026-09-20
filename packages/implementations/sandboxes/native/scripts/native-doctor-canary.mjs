/**
 * @file Sandbox doctor 真实围栏验证脚本。
 *
 * 关键点（中文）
 * - 在宿主上实跑 doctor，验证探针能真实判定围栏，而不是只在假 Provider 下成立。
 * - 额外跑一次「故意放宽围栏」的对照，确认 doctor 能发现失效的围栏。
 * - 这是临时验证产物，结论进入设计文档后即可删除。
 */

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { NativeSandboxProvider, run_sandbox_doctor } from "../bin/index.js";

/** 使用宿主 Node 能力的最小启动器，语义与 City 侧一致。 */
function create_launcher() {
  return {
    async launch(request) {
      const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        stdio: "pipe",
        env: { ...request.env },
      });
      const pending_data = [];
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
          pending_data.push(chunk);
          return;
        }
        for (const callback of data_callbacks) callback(chunk);
      };
      child.stdout?.on("data", publish);
      child.stderr?.on("data", publish);
      child.once("close", (code) =>
        settle({ kind: "exit", exit_code: typeof code === "number" ? code : -1 })
      );
      child.once("error", (error) => settle({ kind: "error", error }));
      return {
        pid: child.pid,
        get writable() {
          return !stdin_closed && Boolean(child.stdin?.writable);
        },
        on_data(callback) {
          data_callbacks.add(callback);
          while (pending_data.length > 0) callback(pending_data.shift());
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
    },
  };
}

/** 打印一份 doctor 报告。 */
function print_report(label, report) {
  console.log("");
  console.log(`=== ${label}`);
  console.log(`backend=${report.backend} provider_ok=${report.provider_ok} fence_ok=${report.fence_ok} env_warnings=${report.environment_warnings}`);
  console.log(`${"探针".padEnd(34)} ${"期望".padEnd(8)} ${"结果".padEnd(6)} 输出`);
  console.log("-".repeat(84));
  for (const result of report.results) {
    console.log(
      `${result.title.padEnd(34)} ${result.expectation.padEnd(8)} ${(result.ok ? "PASS" : "FAIL").padEnd(6)} ${result.output_excerpt.slice(0, 40)}`,
    );
    if (result.explanation) console.log(`${"".padEnd(34)} 解释: ${result.explanation.slice(0, 110)}`);
  }
}

async function main() {
  const workspace_path = await mkdtemp(path.join(os.tmpdir(), "downcity-doctor-"));
  const runtime_path = await mkdtemp(path.join(os.tmpdir(), "downcity-doctor-rt-"));
  const provider = new NativeSandboxProvider();
  const binding = {
    workspace_id: "doctor",
    workspace_path,
    runtime_path,
    launcher: create_launcher(),
  };

  const report = await run_sandbox_doctor({ provider, binding });
  print_report("围栏正常", report);

  await rm(workspace_path, { recursive: true, force: true });
  await rm(runtime_path, { recursive: true, force: true });

  // 负向对照：把 HOME 本身当作 Workspace 可写根，越界写探针就不再被拒。
  // 用于证明 doctor 能发现失效的围栏，而不是永远报通过。
  const leak_runtime = await mkdtemp(path.join(os.tmpdir(), "downcity-doctor-leak-"));
  const leak_report = await run_sandbox_doctor({
    provider,
    binding: {
      workspace_id: "doctor-leak",
      workspace_path: String(process.env.HOME || "").trim(),
      runtime_path: leak_runtime,
      launcher: create_launcher(),
    },
  });
  print_report("负向对照：HOME 被当作可写根", leak_report);
  await rm(leak_runtime, { recursive: true, force: true });

  const fence_ok = report.fence_ok;
  const provider_ok = report.provider_ok;
  const control_ok = leak_report.fence_ok === false;
  console.log("");
  console.log(fence_ok && provider_ok
    ? `围栏正常场景：doctor 正确判定成立（${report.results.length} 条探针）`
    : `围栏正常场景：异常，fence_ok=${fence_ok} provider_ok=${provider_ok}`);
  console.log(control_ok
    ? "负向对照：doctor 正确判定围栏失效"
    : "负向对照：doctor 未发现失效的围栏（判定逻辑不可信）");
}

await main();
