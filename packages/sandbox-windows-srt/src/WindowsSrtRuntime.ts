/**
 * Anthropic SRT 进程级运行时协调器。
 *
 * 关键点（中文）
 * - Anthropic SandboxManager 是全局单例，同一进程只允许一个活动 workspace 安全域。
 * - 不同策略只可在没有活动子进程时切换，禁止把多个 workspace 的 ACL 合并到同一 SID。
 * - adapter dispose 后清理代理与会话级 ACL。
 */

import {
  SandboxManager,
  parseWindowsBinShell,
} from "@anthropic-ai/sandbox-runtime";
import type { SandboxSpawnRequest } from "@downcity/workspace/protocol";
import { build_windows_srt_env, inject_windows_srt_env } from "./WindowsSrtEnvironment.js";
import { build_windows_srt_config } from "./WindowsSrtPolicy.js";
import type {
  WindowsSrtSandboxOptions,
  WindowsSrtSpawnDescriptor,
} from "./types/WindowsSrt.js";

let runtime_owner: symbol | null = null;
let runtime_fingerprint: string | null = null;
let active_processes = 0;
let reset_promise: Promise<void> | null = null;
let runtime_operation: Promise<void> = Promise.resolve();

async function with_runtime_lock<T>(action: () => Promise<T>): Promise<T> {
  const previous_operation = runtime_operation;
  let release_lock!: () => void;
  runtime_operation = new Promise<void>((resolve) => {
    release_lock = resolve;
  });
  await previous_operation;
  try {
    return await action();
  } finally {
    release_lock();
  }
}

async function reset_runtime(): Promise<void> {
  if (!reset_promise) {
    reset_promise = SandboxManager.reset().finally(() => {
      runtime_fingerprint = null;
      reset_promise = null;
    });
  }
  await reset_promise;
}

/** 为单次执行取得已经初始化的 SRT spawn descriptor。 */
export async function acquire_windows_srt_runtime(
  owner: symbol,
  request: SandboxSpawnRequest,
  options: WindowsSrtSandboxOptions,
): Promise<WindowsSrtSpawnDescriptor> {
  return await with_runtime_lock(async () => {
    if (runtime_owner && runtime_owner !== owner && active_processes > 0) {
      throw new Error(
        "Windows SRT currently permits only one active Downcity workspace per process. Close the other Shell before starting this workspace.",
      );
    }
    if (
      runtime_fingerprint
      && runtime_fingerprint !== request.policy.fingerprint
      && active_processes > 0
    ) {
      throw new Error(
        "Windows SRT policy changed while sandboxed processes are active. Close the active Shell sessions and retry.",
      );
    }

    if (
      runtime_fingerprint
      && (runtime_owner !== owner || runtime_fingerprint !== request.policy.fingerprint)
    ) {
      await reset_runtime();
    }
    runtime_owner = owner;

    if (!runtime_fingerprint) {
      try {
        await SandboxManager.initialize(build_windows_srt_config(request, options));
        runtime_fingerprint = request.policy.fingerprint;
      } catch (error) {
        runtime_owner = null;
        await reset_runtime().catch(() => undefined);
        throw error;
      }
    }

    active_processes += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      active_processes = Math.max(0, active_processes - 1);
      SandboxManager.cleanupAfterCommand();
    };

    try {
      const wrapped = await SandboxManager.wrapWithSandboxArgv(
        request.cmd,
        parseWindowsBinShell(request.shell_path),
        undefined,
        undefined,
        request.cwd,
      );
      return {
        argv: inject_windows_srt_env(
          wrapped.argv,
          build_windows_srt_env(request),
        ),
        env: wrapped.env,
        release,
      };
    } catch (error) {
      release();
      throw error;
    }
  });
}

/** 释放指定 adapter 拥有的全局 SRT runtime。 */
export async function dispose_windows_srt_runtime(owner: symbol): Promise<void> {
  await with_runtime_lock(async () => {
    if (runtime_owner !== owner) return;
    if (active_processes > 0) {
      throw new Error("Cannot dispose Windows SRT while sandboxed processes are still active.");
    }
    runtime_owner = null;
    await reset_runtime();
  });
}
