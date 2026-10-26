/**
 * 原生围栏运行时自检。
 *
 * 使用自有临时文件验证允许写入、只读覆盖、敏感内容隔离与子进程继承。
 * 负向探针只有明确返回预期拒绝状态才通过，启动失败和超时不能冒充隔离成功。
 * 不读取用户真实凭证；所有进程有独立进程组和有界执行时间。
 */

import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SandboxProviderIssue, SandboxNetworkMode } from "@downcity/type/shell";
import { resolve_sandbox_policy } from "../policy/SandboxPolicy.js";
import { run_probe_process } from "./ProbeProcess.js";
import { check_network_boundary } from "./NetworkCanary.js";
import type { ResolvedSandboxPolicy } from "../types/SandboxPolicy.js";

/** 有界执行探针，返回退出码；启动失败、信号退出和超时统一返回 -1。 */
async function run_probe(policy: ResolvedSandboxPolicy, cmd: string, targets: string[]): Promise<number> {
  return await run_probe_process(policy, {
    command: "/bin/sh", args: ["-c", cmd, "canary", ...targets],
  });
}

/** 验证当前平台是否忠实执行文件权限；不访问用户敏感内容。 */
export async function run_sandbox_canary(network: SandboxNetworkMode): Promise<SandboxProviderIssue[]> {
  const issues: SandboxProviderIssue[] = [];
  const probe_root = await realpath(await mkdtemp(path.join(os.tmpdir(), "downcity-canary-")));
  const denied_target = path.join(os.homedir(), `.downcity-canary-${path.basename(probe_root)}`);
  try {
    const readonly_path = path.join(probe_root, "readonly");
    const protected_path = path.join(probe_root, "protected");
    await mkdir(readonly_path);
    await mkdir(protected_path);
    await writeFile(path.join(protected_path, "secret"), "canary-secret");
    const base = resolve_sandbox_policy({ binding: {
      workspace_id: "canary", workspace_path: probe_root, runtime_path: probe_root, network,
      granted_mounts: [{ host_path: readonly_path, access: "ro", reason: "canary" }],
    } });
    const policy: ResolvedSandboxPolicy = {
      ...base,
      filesystem_rules: [...base.filesystem_rules, {
        path: protected_path, access: "deny", source: "protected", scope: "subpath",
      }],
    };
    const probes = [
      { code: "workspace_write_denied", cmd: 'printf ok > "$1"', targets: [path.join(probe_root, "allowed")], expected: 0 },
      { code: "denial_not_enforced", cmd: 'if printf bad > "$1"; then exit 0; else exit 77; fi', targets: [denied_target], expected: 77 },
      { code: "readonly_not_enforced", cmd: 'if printf bad > "$1"; then exit 0; else exit 77; fi', targets: [path.join(readonly_path, "blocked")], expected: 77 },
      { code: "protected_read_not_enforced", cmd: 'if [ "$(cat "$1" 2>/dev/null)" = canary-secret ]; then exit 0; else exit 77; fi', targets: [path.join(protected_path, "secret")], expected: 77 },
      { code: "child_denial_not_enforced", cmd: '/bin/sh -c \'if printf bad > "$1"; then exit 0; else exit 77; fi\' canary "$1"', targets: [path.join(readonly_path, "child")], expected: 77 },
    ];
    for (const probe of probes) {
      if (await run_probe(policy, probe.cmd, probe.targets) !== probe.expected) {
        issues.push({ code: probe.code, message: `Sandbox canary failed: ${probe.code}`, fixes: ["Check the native sandbox policy and platform wrapper; do not fall back to host execution."] });
      }
    }
    // 文件探针必须先通过，避免用环境启动失败误判网络隔离。
    if (issues.length === 0) issues.push(...await check_network_boundary(policy));
  } finally {
    await rm(denied_target, { force: true }).catch(() => undefined);
    await rm(probe_root, { recursive: true, force: true });
  }
  return issues;
}
