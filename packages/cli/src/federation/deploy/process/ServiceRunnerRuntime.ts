/**
 * launchd/systemd 运行器：加载独立 release 和私有运行配置，转发退出信号，写运行事实。
 *
 * 恢复调度交给操作系统，本模块不实现常驻重试循环。每次启动限制在 60 秒内 5 次，
 * 并生成新 instance_id。启动次数超限时以成功码退出抑制 launchd 恢复，receipt 明确记录原因。
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { read_node_release } from "@/federation/deploy/release/NodeReleaseBuilder.js";
import { read_local_runtime_config } from "@/federation/deploy/release/LocalRuntimeConfig.js";
import { read_service_config, write_service_json, type ServiceRuntimeReceipt } from "./ServiceRuntime.js";

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
  try {
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
    mkdirSync(dirname(config.log_path), { recursive: true, mode: 0o700 });
    const log_fd = openSync(config.log_path, "a", 0o600);
    const entry = resolve(config.release_dir, manifest.entry);
    const child = (() => {
      try {
        return spawn(process.execPath, [entry], {
          cwd: dirname(entry),
          env: { ...base_env, ...runtime_env, HOST: config.host, PORT: String(config.port),
            PUBLIC_URL: config.base_url, DOWNCITY_FEDERATION_BASE_URL: config.base_url,
            DOWNCITY_FED_ID: config.fed_id, DOWNCITY_RELEASE_ID: config.release_id,
            DOWNCITY_FED_INSTANCE_ID: receipt.instance_id },
          stdio: ["ignore", log_fd, log_fd],
        });
      } finally { closeSync(log_fd); }
    })();
    let stop_requested = false;
    const stop_child = () => { stop_requested = true; child.kill("SIGTERM"); };
    process.on("SIGTERM", stop_child);
    process.on("SIGINT", stop_child);
    try {
      const completion = new Promise<number>((done) => {
        child.once("error", () => done(1));
        child.once("exit", (code, signal) => done(stop_requested ? 0 : signal ? 1 : (code ?? 1)));
      });
      // running 只表示子进程已分配，不表示应用已就绪，CLI 还需健康身份校验。
      if (child.pid) await write_service_json(config.receipt_path, { ...receipt, state: "running", updated_at: new Date().toISOString() });
      const code = await completion;
      await write_service_json(config.receipt_path, { ...receipt, state: code === 0 ? "stopped" : "failed", updated_at: new Date().toISOString() });
      return code;
    } finally {
      process.off("SIGTERM", stop_child);
      process.off("SIGINT", stop_child);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
  } catch {
    await write_service_json(config.receipt_path, { ...receipt, state: "failed", updated_at: new Date().toISOString() });
    // 错误仅返回操作状态，避免将配置值或驱动连接诊断输出到系统日志。
    return 1;
  }
}
