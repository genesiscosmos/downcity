/**
 * launchd/systemd 运行器：加载独立 release 和私有运行配置，转发退出信号，写运行事实。
 *
 * 恢复调度交给操作系统，本模块不实现常驻重试循环。每次启动限制在 60 秒内 5 次，
 * 并生成新 instance_id。启动次数超限时以成功码退出抑制 launchd 恢复，receipt 明确记录原因。
 */
import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { read_node_release } from "@/federation/deploy/release/NodeReleaseBuilder.js";
import { read_local_runtime_config } from "@/federation/deploy/release/LocalRuntimeConfig.js";
import { read_service_config, write_service_json, type ServiceRuntimeReceipt } from "./ServiceRuntime.js";
import { open_rotating_output, run_logged_application } from "./ManagedServiceOutput.js";

/** 执行一次已登记服务启动；只有显式运行器入口调用，不在模块导入时操作进程。 */
export async function run_managed_service(config_path: string): Promise<number> {
  const config = await read_service_config(config_path);
  const receipt: ServiceRuntimeReceipt = { fed_id: config.fed_id, release_id: config.release_id,
    launch_id: config.launch_id, instance_id: `fed_instance_${randomUUID().replace(/-/gu, "")}`,
    pid: process.pid, state: "starting", updated_at: new Date().toISOString() };
  const now = Date.now();
  let attempts: number[] = [];
  try {
    const saved: unknown = JSON.parse(await readFile(config.attempts_path, "utf8"));
    if (!Array.isArray(saved) || saved.some((item) => !Number.isFinite(item))) throw new Error("Invalid startup window");
    attempts = saved.filter((time) => time > now - 60_000 && time <= now);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await write_service_json(config.receipt_path, { ...receipt, state: "rate_limited" });
      return 0;
    }
  }
  if (attempts.length >= 5) {
    await write_service_json(config.receipt_path, { ...receipt, state: "rate_limited" });
    return 0;
  }
  await write_service_json(config.attempts_path, [...attempts, now]);
  await write_service_json(config.receipt_path, receipt);
  let supervisor: Writable | undefined;
  let logging_failed = false;
  let supervisor_failed = false;
  // 诊断只含固定事件和错误码，不包含业务输出、请求正文或配置值。
  const diagnostic = async (code: string) => {
    if (!supervisor || supervisor_failed) return;
    await new Promise<void>((done, reject) => supervisor!.write(`${JSON.stringify({ event: "federation_service", code })}\n`, (error) => error ? reject(error) : done()));
  };
  try {
    try {
      supervisor = await open_rotating_output(join(dirname(config_path), "supervisor.log"), { max_bytes: 2 * 1024 * 1024, archive_count: 3 });
    } catch { supervisor_failed = true; throw new Error("Supervisor logging unavailable"); }
    supervisor.on("error", () => { supervisor_failed = true; });
    await diagnostic("RUNNER_START");
    const manifest = await read_node_release(config.release_dir, config.fed_id, config.release_id);
    const runtime_env = read_local_runtime_config(config.runtime_config_path);
    if (!runtime_env.DATABASE_PATH || !(await stat(runtime_env.DATABASE_PATH)).isFile()) {
      throw new Error("The deployed database is missing");
    }
    // 服务环境只继承基本操作系统变量；加载参数与业务秘密从私有快照分别管理。
    const base_env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "TZ"]) {
      if (process.env[key]) base_env[key] = process.env[key];
    }
    const entry = resolve(config.release_dir, manifest.entry);
    const code = await run_logged_application({ entry, cwd: dirname(entry), log_path: config.log_path,
      env: { ...base_env, ...runtime_env, HOST: config.host, PORT: String(config.port),
        PUBLIC_URL: config.base_url, DOWNCITY_FEDERATION_BASE_URL: config.base_url,
        DOWNCITY_FED_ID: config.fed_id, DOWNCITY_RELEASE_ID: config.release_id,
        DOWNCITY_FED_INSTANCE_ID: receipt.instance_id },
      on_started: () => write_service_json(config.receipt_path, { ...receipt, state: "running", updated_at: new Date().toISOString() }),
      on_log_failure: () => { logging_failed = true; },
    });
    await diagnostic(logging_failed ? "APPLICATION_LOG_FAILED" : code === 0 ? "APPLICATION_STOPPED" : "APPLICATION_FAILED");
    await new Promise<void>((done, reject) => supervisor!.end((error?: Error) => error ? reject(error) : done()));
    await finished(supervisor);
    await write_service_json(config.receipt_path, { ...receipt, state: code === 0 ? "stopped" : "failed",
      ...(logging_failed ? { failure_code: "APPLICATION_LOG_FAILED" as const } : {}), updated_at: new Date().toISOString() });
    return code;
  } catch {
    await diagnostic(logging_failed ? "APPLICATION_LOG_FAILED" : "RUNNER_FAILED").catch(() => {});
    await write_service_json(config.receipt_path, { ...receipt, state: "failed",
      failure_code: supervisor_failed ? "SUPERVISOR_LOG_FAILED" : logging_failed ? "APPLICATION_LOG_FAILED" : "RUNNER_FAILED",
      updated_at: new Date().toISOString() });
    return 1;
  } finally {
    if (supervisor && !supervisor.destroyed) supervisor.end();
    if (supervisor) await finished(supervisor).catch(() => {});
  }
}
