/**
 * 用户级系统服务的启动描述与单次运行凭据。
 *
 * launch.json 仅保存产物及配置文件引用，不保存秘密；系统每次恢复进程都生成新的
 * instance_id，并原子更新 receipt.json，CLI 通过托管器 PID 与 receipt 联合核对。
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { local_release_paths } from "@/federation/deploy/release/LocalReleaseStore.js";

/** 系统服务持久化的非敏感启动配置。 */
export interface ServiceRuntimeConfig {
  /** 协议版本，固定为 1。 */
  schema: 1;
  /** 稳定 Federation 身份。 */
  fed_id: string;
  /** 本次显式启动操作标识，区分替换配置前后的 receipt。 */
  launch_id: string;
  /** 已校验发布版本标识。 */
  release_id: string;
  /** 安装产物的绝对路径。 */
  release_dir: string;
  /** 产物入口，相对 release 根目录。 */
  entry: string;
  /** 含业务配置的私有文件绝对路径，仅服务运行器读取。 */
  runtime_config_path: string;
  /** 监听主机地址。 */
  host: string;
  /** 固定监听端口。 */
  port: number;
  /** 对外服务地址。 */
  base_url: string;
  /** 输出日志绝对路径。 */
  log_path: string;
  /** 每次运行原子写入的 receipt 绝对路径。 */
  receipt_path: string;
  /** 失败启动窗口记录，限制 launchd 连续恢复频率。 */
  attempts_path: string;
  /** 是否允许异常退出后由系统恢复。 */
  restart_on_failure: boolean;
}

/** 系统恢复后可刷新且不含业务配置的运行事实。 */
export interface ServiceRuntimeReceipt {
  /** 稳定 Fed 身份。 */
  fed_id: string;
  /** 显式启动配置标识，必须与 launch.json 匹配。 */
  launch_id: string;
  /** 实际运行的发布版本。 */
  release_id: string;
  /** 本次由运行器生成的实例身份。 */
  instance_id: string;
  /** 系统托管的主运行器进程 PID。 */
  pid: number;
  /** 当前运行阶段，不等同于应用就绪。 */
  state: "starting" | "running" | "stopped" | "failed" | "rate_limited";
  /** 固定运行器故障码，不包含日志内容或配置值；日志不可用时仍可通过 status 诊断。 */
  failure_code?: "APPLICATION_LOG_FAILED" | "SUPERVISOR_LOG_FAILED" | "RUNNER_FAILED";
  /** 最近一次状态变化时间。 */
  updated_at: string;
}

/** 同一 Fed 的系统服务私有文件位置。 */
export function service_runtime_paths(fed_id: string): {
  /** 受管理的私有目录。 */
  service_dir: string;
  /** 无秘密的启动描述文件。 */
  config_path: string;
  /** 单次运行事实文件。 */
  receipt_path: string;
  /** 恢复频率窗口记录。 */
  attempts_path: string;
} {
  const service_dir = join(local_release_paths(fed_id).deployment_dir, "service");
  return { service_dir, config_path: join(service_dir, "launch.json"),
    receipt_path: join(service_dir, "receipt.json"), attempts_path: join(service_dir, "attempts.json") };
}

/** 原子写入私有控制文件，避免系统重启读到半份内容。 */
export async function write_service_json(file_path: string, value: unknown): Promise<void> {
  await mkdir(dirname(file_path), { recursive: true, mode: 0o700 });
  const temporary_path = `${file_path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary_path, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary_path, file_path);
  } finally { await rm(temporary_path, { force: true }); }
}

/** 校验持久启动配置结构及控制文件位置，拒绝读取源码或任意 receipt 路径。 */
export async function read_service_config(config_path: string): Promise<ServiceRuntimeConfig> {
  const value: unknown = JSON.parse(await readFile(config_path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid system service launch configuration");
  const config = value as ServiceRuntimeConfig;
  if (config.schema !== 1 || typeof config.fed_id !== "string" || !/^fed_[\w-]+$/u.test(config.fed_id)
    || typeof config.launch_id !== "string" || !config.launch_id || typeof config.release_id !== "string" || !config.release_id
    || config.entry !== "app/index.mjs" || typeof config.host !== "string" || !config.host
    || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535
    || typeof config.restart_on_failure !== "boolean") throw new Error("Invalid system service launch configuration");
  for (const key of ["release_dir", "runtime_config_path", "log_path", "receipt_path", "attempts_path"] as const) {
    if (typeof config[key] !== "string" || !isAbsolute(config[key])) throw new Error("Invalid service file reference");
  }
  if (typeof config.base_url !== "string" || !["http:", "https:"].includes(new URL(config.base_url).protocol)) throw new Error("Invalid service URL");
  const control_dir = await realpath(dirname(config_path));
  if (basename(config.receipt_path) !== "receipt.json" || basename(config.attempts_path) !== "attempts.json"
    || await realpath(dirname(config.receipt_path)) !== control_dir || await realpath(dirname(config.attempts_path)) !== control_dir) {
    throw new Error("Service control paths must remain in the launch directory");
  }
  return config;
}

/** 读取并核对运行凭据，不将缺失或损坏的记录当作存活实例。 */
export async function read_service_receipt(config: ServiceRuntimeConfig): Promise<ServiceRuntimeReceipt | undefined> {
  try {
    const value = JSON.parse(await readFile(config.receipt_path, "utf8")) as ServiceRuntimeReceipt;
    if (value.fed_id !== config.fed_id || value.release_id !== config.release_id || value.launch_id !== config.launch_id
      || typeof value.instance_id !== "string" || !value.instance_id || !Number.isSafeInteger(value.pid) || value.pid < 1
      || !["starting", "running", "stopped", "failed", "rate_limited"].includes(value.state)
      || (value.failure_code !== undefined && !["APPLICATION_LOG_FAILED", "SUPERVISOR_LOG_FAILED", "RUNNER_FAILED"].includes(value.failure_code))
      || !Number.isFinite(Date.parse(value.updated_at))) throw new Error("Invalid service receipt");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Invalid system service receipt");
  }
}
