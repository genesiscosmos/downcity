/**
 * @file 验证 daemon stop 不会因 stale PID 误杀无关进程。
 *
 * ## 为什么保留这个文件
 *
 * daemon 的 pid/meta 文件是「谁拥有这个进程」的唯一凭据。文件陈旧或与实际进程不一致时，
 * 如果 stop 直接按 pid 发信号，就会杀掉一个碰巧复用了该 pid 的无关进程。
 * 这个安全性原先是本文件守护的；daemon API 重构后它成了无人执行的孤儿（导入名与路径模型都已变化），
 * 本次按当前契约重写，而不是删除。
 *
 * ## 当前契约（app/cli/src/city/process/daemon/Manager.ts）
 *
 * | 状态 | 行为 |
 * | --- | --- |
 * | 无 pid 文件 | 返回 `{ stopped: false }`，不报错 |
 * | pid 对应进程已不存在 | 清理陈旧 pid/meta 文件，返回 `{ stopped: false, pid }` |
 * | pid 对应进程健在但身份不可用（无 meta 或 pid 不一致） | **抛错并拒绝发信号** |
 *
 * 路径是全局的（不再按 project_root 区分），因此用 `DC_PLATFORM_ROOT` 隔离到临时目录。
 *
 * ## 未覆盖
 *
 * 身份完全匹配后的 SIGTERM/SIGKILL 路径需要真实 RPC 服务器：`read_runtime_identity`
 * 会连接 meta 里的 `rpc_host` / `rpc_port` 校验 daemon 自报的 pid 与 instance_id。
 * 那属于 daemon 生命周期集成测试，不在本文件范围内 —— 本文件只守「身份不可用时不误杀」。
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/** 起一个临时平台根目录，并把 daemon 路径隔离进去。 */
async function create_isolated_platform_root() {
  const platform_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-daemon-identity-"));
  process.env.DC_PLATFORM_ROOT = platform_root;
  return platform_root;
}

/** 等一个进程真正退出，避免用「刚 spawn 就 kill」得到的 pid 与进程状态竞争。 */
function wait_for_exit(child) {
  return new Promise((resolve) => child.once("exit", resolve));
}

/** 尽力回收子进程，避免测试自身泄漏。 */
function kill_quietly(pid) {
  if (!pid) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // 子进程可能已自行退出。
  }
}

test("daemon stop 清理已死 PID 的陈旧文件，且不误杀任何进程", async () => {
  const platform_root = await create_isolated_platform_root();
  // 先起一个短命进程并等它退出，得到一个确定已不存在的 pid。
  const probe = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  await wait_for_exit(probe);
  const dead_pid = probe.pid;
  assert.ok(dead_pid, "未能取得探测进程的 pid");

  try {
    const manager = await import("../bin/city/process/daemon/Manager.js");
    const pid_path = manager.get_daemon_pid_path();
    const meta_path = manager.get_daemon_meta_path();
    await fs.mkdir(path.dirname(pid_path), { recursive: true });
    await fs.writeFile(pid_path, String(dead_pid), "utf8");

    const result = await manager.stop_daemon_process(50);

    assert.deepEqual(result, { stopped: false, pid: dead_pid });
    // 陈旧文件必须被清掉，否则下次启动会一直读到失效状态。
    await assert.rejects(fs.stat(pid_path), /ENOENT/);
    await assert.rejects(fs.stat(meta_path), /ENOENT/);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    await fs.rm(platform_root, { recursive: true, force: true });
  }
});

test("daemon stop 在身份不可用时拒绝发信号，不误杀无关进程", async () => {
  const platform_root = await create_isolated_platform_root();
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  assert.ok(child.pid, "未能取得子进程 pid");

  try {
    const manager = await import("../bin/city/process/daemon/Manager.js");
    const pid_path = manager.get_daemon_pid_path();
    await fs.mkdir(path.dirname(pid_path), { recursive: true });
    // 只写 pid、不写 meta：模拟 pid 文件被陈旧数据占用而身份无法证明的情况。
    await fs.writeFile(pid_path, String(child.pid), "utf8");

    await assert.rejects(
      manager.stop_daemon_process(50),
      /identity is unavailable/,
      "身份不可用时必须抛错拒绝发信号，而不是按 pid 直接杀进程",
    );
    // 本文件的核心断言：这个无辜进程必须活下来。
    assert.doesNotThrow(() => process.kill(child.pid, 0), "无关进程被误杀了");
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    kill_quietly(child.pid);
    await fs.rm(platform_root, { recursive: true, force: true });
  }
});
