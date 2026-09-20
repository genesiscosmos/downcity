/**
 * @file Sandbox doctor 的契约测试。
 *
 * 关键点（中文）
 * - 用内存 Provider 覆盖编排逻辑，不启动真实围栏。
 * - 真实围栏是否成立由 `native-canary.mjs` 与 `Provider.check()` 负责。
 * - 覆盖重点：探针定义成对、期望判定、拒绝类探针只看退出码回显、报告聚合、解释回填。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { build_sandbox_probes, run_sandbox_doctor } from "../bin/index.js";

const workspace_path = "/projects/docs";
const runtime_path = "/downcity/city-a";

/**
 * 探针模拟结果。
 *
 * - `ok`：允许类探针成功，或拒绝类探针真的被拦下。
 * - `leak`：拒绝类探针没有被拦下（越界操作成功）。
 * - `fail`：允许类探针执行失败。
 */
const PROBE_OUTCOMES = {
  ok: { exit_code: 0, output: "ok\n" },
  leak: { exit_code: 0, output: "leaked\nexit=0\n" },
  fail: { exit_code: 1, output: "boom\nexit=1\n" },
  deny: { exit_code: 0, output: "denied\nexit=1\n" },
  /** 允许的操作被围栏拦下：这是最需要解释的失败形态。 */
  denied_write: {
    exit_code: 1,
    output: `/bin/sh: ${workspace_path}/.doctor: Operation not permitted\nexit=1\n`,
  },
};

/**
 * 创建按探针 id 决定结果的假 Sandbox。
 *
 * 关键点（中文）
 * - 默认模拟「围栏正确」：`*_denied` 探针被拦下，其余探针成功。
 * - `behaviors` 按探针 id 前缀覆盖默认结果，用于翻转单条探针。
 * - 句柄缓存早到的输出与终态，与真实实现一致：探针在 spawn 返回后才注册监听器。
 */
function create_fake_provider(behaviors = {}) {
  return {
    backend: "fake",
    async check() {
      return { ok: true, backend: "fake", issues: [] };
    },
    create_workspace(binding) {
      return {
        id: `fake-${binding.workspace_id}`,
        backend: "fake",
        workspace_path: binding.workspace_path,
        async spawn(request) {
          const probe_id = request.execution_id.replace(/^doctor_/, "");
          const override = Object.entries(behaviors)
            .find(([prefix]) => probe_id.startsWith(prefix))?.[1];
          const outcome = override ?? (probe_id.endsWith("_denied") ? "deny" : "ok");
          const { exit_code, output } = PROBE_OUTCOMES[outcome];
          const pending_data = [output];
          const exit_callbacks = new Set();
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            for (const callback of exit_callbacks) callback(exit_code);
            exit_callbacks.clear();
          };
          return {
            child: {
              writable: false,
              on_data(callback) {
                while (pending_data.length > 0) callback(pending_data.shift());
              },
              on_exit(callback) {
                if (settled) {
                  queueMicrotask(() => callback(exit_code));
                  return;
                }
                exit_callbacks.add(callback);
              },
              on_error() {},
              async write() {},
              // 调用方注册完监听后会关闭 stdin；以此为投递终态的时机。
              close_stdin() {
                queueMicrotask(settle);
              },
              kill() {
                queueMicrotask(settle);
              },
            },
            cwd: request.cwd,
            backend: "fake",
            sandbox_id: "fake",
          };
        },
        describe() {
          return {
            backend: "fake",
            sandbox_id: "fake",
            workdir: binding.workspace_path,
            mounts: [],
            network: "allow",
            read_scope: "host",
            writable_roots: [binding.workspace_path, binding.runtime_path],
            denied_read_paths: [],
            policy_digest: "fake",
            persistent: true,
          };
        },
        async stop() {},
      };
    },
  };
}

/** 运行一次 doctor。 */
async function run_doctor(behaviors = {}) {
  return await run_sandbox_doctor({
    provider: create_fake_provider(behaviors),
    binding: { workspace_id: "docs", workspace_path, runtime_path },
  });
}

test("探针同时覆盖允许与拒绝两类，且拒绝探针自带退出码回显", () => {
  const probes = build_sandbox_probes({
    workspace_path,
    runtime_path,
    home_path: "/home/user",
    pid: 4242,
  });

  const fence_probes = probes.filter((probe) => probe.severity === "fence");
  assert.ok(fence_probes.some((probe) => probe.expectation === "succeed"));
  assert.ok(fence_probes.some((probe) => probe.expectation === "deny"));
  for (const probe of fence_probes.filter((item) => item.expectation === "deny")) {
    assert.match(probe.command, /echo exit=\$\?/, `${probe.id} 必须回显退出码`);
  }
  assert.ok(probes.some((probe) => probe.severity === "environment"));
  assert.ok(probes.every((probe) => probe.id && probe.title && probe.command));
});

test("围栏正确时报告为通过", async () => {
  const report = await run_doctor();

  assert.equal(report.provider_ok, true);
  assert.equal(report.fence_ok, true);
  assert.equal(report.environment_warnings, 0);
  assert.ok(report.results.every((result) => result.ok));
  assert.equal(report.sandbox_id, "fake-docs");
  assert.match(report.policy_digest, /^[a-f0-9]{16}$/);
});

test("越界写入未被拦下时围栏判定为失败", async () => {
  const report = await run_doctor({ fence_outside_denied: "leak" });

  assert.equal(report.fence_ok, false);
  const failed = report.results.find((result) => result.probe_id === "fence_outside_denied");
  assert.equal(failed?.ok, false);
  assert.equal(failed?.expectation, "deny");
});

test("拒绝类探针只看退出码回显，不看进程退出码", async () => {
  // 被围栏拒绝时子进程整体仍以 0 退出；回显 exit=0 才说明越界操作真的成功了。
  const report = await run_doctor({ fence_ssh_denied: "leak" });

  const ssh_result = report.results.find((result) => result.probe_id === "fence_ssh_denied");
  assert.equal(ssh_result?.ok, false);
  assert.equal(report.fence_ok, false);
});

test("允许类探针执行失败时围栏判定为失败", async () => {
  const report = await run_doctor({ fence_workspace_write: "fail" });

  const failed = report.results.find((result) => result.probe_id === "fence_workspace_write");
  assert.equal(failed?.ok, false);
  assert.equal(report.fence_ok, false);
});

test("环境类探针失败只计为警告，不影响围栏结论", async () => {
  const report = await run_doctor({ env_network: "fail" });

  assert.equal(report.fence_ok, true);
  assert.equal(report.environment_warnings, 1);
});

test("允许的操作被拒时回填可执行解释", async () => {
  const report = await run_doctor({ fence_workspace_write: "denied_write" });

  const failed = report.results.find((result) => result.probe_id === "fence_workspace_write");
  assert.equal(failed?.ok, false);
  assert.ok(failed?.explanation);
  assert.match(failed.explanation, /writable/i);
});

test("围栏泄漏时没有可解释内容，保持 null", async () => {
  // 越界写成功了，输出里不会有权限拒绝信息；不应伪造解释。
  const report = await run_doctor({ fence_outside_denied: "leak" });

  const failed = report.results.find((result) => result.probe_id === "fence_outside_denied");
  assert.equal(failed?.ok, false);
  assert.equal(failed?.explanation, null);
});

test("Provider 自检失败时报告如实反映", async () => {
  const provider = create_fake_provider();
  provider.check = async () => ({
    ok: false,
    backend: "fake",
    issues: [{ code: "wrapper_not_installed", message: "missing", fixes: [] }],
  });

  const report = await run_sandbox_doctor({
    provider,
    binding: { workspace_id: "docs", workspace_path, runtime_path },
  });

  assert.equal(report.provider_ok, false);
  assert.deepEqual(report.provider_issues, ["wrapper_not_installed: missing"]);
});
