/**
 * Sandbox doctor 执行编排。
 *
 * 关键点（中文）
 * - 逐条在围栏内执行探针，并按期望值判定通过。
 * - 拒绝类探针不依赖退出码语义，而是看进程是否真的被拦下；因此探针命令自己把
 *   退出码回显到 stdout，避免 shell 把非零退出码转成整体失败而丢失信息。
 * - 未通过时用 Provider 的拒绝翻译给出可执行解释，而不是只回一句失败。
 */

import { rm } from "node:fs/promises";
import path from "node:path";
import type {
  SandboxProvider,
  WorkspaceSandbox,
  WorkspaceSandboxBinding,
} from "@downcity/type/shell";
import { build_sandbox_probes } from "./SandboxProbes.js";
import { explain_sandbox_denial } from "../policy/DenialExplainer.js";
import { resolve_sandbox_policy } from "../policy/SandboxPolicy.js";
import type {
  SandboxDoctorReport,
  SandboxProbe,
  SandboxProbeResult,
} from "../types/SandboxDoctor.js";

/** 单条探针执行的原始结果。 */
interface ProbeRunResult {
  /** 进程退出码；无法取得时为 -1。 */
  exit_code: number;
  /** 合并后的标准输出与标准错误。 */
  output: string;
}

/** 输出摘录长度上限，避免报告被长输出淹没。 */
const OUTPUT_EXCERPT_LIMIT = 200;

/** 把输出裁剪成单行摘录。 */
function excerpt(output: string): string {
  const normalized = output.trim().replaceAll(/\s+/g, " ");
  return normalized.length > OUTPUT_EXCERPT_LIMIT
    ? `${normalized.slice(0, OUTPUT_EXCERPT_LIMIT)}…`
    : normalized;
}

/**
 * 判定一条探针是否符合期望。
 *
 * 关键点（中文）
 * - 拒绝类探针在命令内部回显 `exit=<code>`，因此这里读的是回显值而不是进程退出码：
 *   被围栏拒绝时子进程整体仍可能以 0 退出，只看退出码会漏判。
 * - 找不到回显值时回落到进程退出码，保证探针写错时不会误报通过。
 */
function judge_probe(input: {
  /** 探针定义。 */
  probe: SandboxProbe;
  /** 探针原始执行结果。 */
  run: ProbeRunResult;
}): { ok: boolean; observed_exit: number } {
  const echoed = input.run.output.match(/exit=(-?\d+)/);
  const observed_exit = echoed ? Number(echoed[1]) : input.run.exit_code;
  if (input.probe.expectation === "succeed") {
    return { ok: input.run.exit_code === 0, observed_exit };
  }
  return { ok: observed_exit !== 0, observed_exit };
}

/** 在围栏内执行一条探针命令。 */
async function run_probe(input: {
  /** 当前 Workspace Sandbox。 */
  sandbox: WorkspaceSandbox;
  /** 探针定义。 */
  probe: SandboxProbe;
  /** 探针命令的工作目录。 */
  cwd: string;
}): Promise<ProbeRunResult> {
  const spawn = await input.sandbox.spawn({
    execution_id: `doctor_${input.probe.id}`,
    cmd: input.probe.command,
    cwd: input.cwd,
    shell_path: "/bin/sh",
    login: true,
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    terminal: false,
  });
  const chunks: string[] = [];
  spawn.child.on_data((chunk) => chunks.push(String(chunk ?? "")));
  const exit_code = await new Promise<number>((resolve) => {
    spawn.child.on_error(() => resolve(-1));
    spawn.child.on_exit(resolve);
    spawn.child.close_stdin?.();
  });
  return { exit_code, output: chunks.join("") };
}

/**
 * 运行一次完整 doctor。
 *
 * 关键点（中文）
 * - Provider 自检先跑：围栏整体不可用时，逐条探针没有意义。
 * - Provider 自检通过时仍会逐条执行探针，用于回答「哪些路径可写、哪些被拒」。
 */
export async function run_sandbox_doctor(input: {
  /** 当前 Provider。 */
  provider: SandboxProvider;
  /** 用于探针的 Workspace 绑定；必须带上 launcher。 */
  binding: WorkspaceSandboxBinding;
}): Promise<SandboxDoctorReport> {
  const binding: WorkspaceSandboxBinding = {
    ...input.binding,
    workspace_path: path.resolve(input.binding.workspace_path),
    runtime_path: path.resolve(input.binding.runtime_path),
  };
  const sandbox = input.provider.create_workspace(binding);
  const policy = resolve_sandbox_policy({ binding });
  const status = await input.provider.check();
  const home_path = String(process.env.HOME || "").trim() || "/tmp";
  const probe_name = `.downcity-doctor-${process.pid}`;
  const probes = build_sandbox_probes({
    workspace_path: binding.workspace_path,
    runtime_path: binding.runtime_path,
    home_path,
    pid: process.pid,
  });
  const results: SandboxProbeResult[] = [];
  for (const probe of probes) {
    let run: ProbeRunResult;
    try {
      run = await run_probe({ sandbox, probe, cwd: binding.workspace_path });
    } catch (error) {
      run = {
        exit_code: -1,
        output: error instanceof Error ? error.message : String(error),
      };
    }
    const { ok } = judge_probe({ probe, run });
    const denial = ok ? null : explain_sandbox_denial({ output: run.output, policy });
    results.push({
      probe_id: probe.id,
      title: probe.title,
      command: probe.command,
      expectation: probe.expectation,
      severity: probe.severity,
      exit_code: run.exit_code,
      ok,
      output_excerpt: excerpt(run.output),
      explanation: denial?.reason ?? null,
    });
  }
  const fence_results = results.filter((result) => result.severity === "fence");
  // 关键点（中文）：越界探针在围栏泄漏时会真的写出文件，且探针命令自己的清理不会生效。
  // 因此 doctor 必须自己收尾，不能在用户 HOME 留下痕迹。
  await Promise.allSettled([
    path.join(binding.workspace_path, probe_name),
    path.join(binding.runtime_path, probe_name),
    path.join("/tmp", probe_name),
    path.join(home_path, probe_name),
  ].map((target) => rm(target, { force: true })));
  return {
    backend: sandbox.backend,
    provider_ok: status.ok,
    provider_issues: status.issues.map((issue) => `${issue.code}: ${issue.message}`),
    sandbox_id: sandbox.id,
    policy_digest: policy.digest,
    results,
    fence_ok: fence_results.every((result) => result.ok),
    environment_warnings: results.filter(
      (result) => result.severity === "environment" && !result.ok,
    ).length,
  };
}
