/**
 * 本地 Federation 发布存储与操作锁。
 *
 * staging 中构建完整产物，校验后原子重命名为不可变 release；成功就绪后才更新
 * current.json。互斥锁同时覆盖 deploy/restart/stop；归属失效时报告陈旧锁，避免并发误回收。
 */
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getPlatformRootDirPath } from "@/city/process/registry/CityPaths.js";
import { CliError } from "@/shared/CliError.js";

/** 同一个 Fed 的安装、数据、配置与日志位置。 */
export interface LocalReleasePaths {
  /** 该 Fed 的部署根目录。 */
  deployment_dir: string;
  /** 存放完整不可变发布产物的目录。 */
  releases_dir: string;
  /** 安装与构建中的临时目录。 */
  staging_dir: string;
  /** 发布之间共享的默认持久化目录。 */
  data_dir: string;
  /** 独立运行配置所在目录。 */
  config_dir: string;
  /** 合并服务日志的绝对文件路径。 */
  log_path: string;
  /** 成功发布指针；内容只包含 release_id，不包含秘密。 */
  current_path: string;
}

/** 根据稳定 Fed ID 生成用户级目录，拒绝路径逃逸。 */
export function local_release_paths(fed_id: string): LocalReleasePaths {
  if (!/^fed_[a-zA-Z0-9_-]+$/u.test(fed_id)) throw new CliError({ title: "Invalid Federation ID" });
  const root = join(getPlatformRootDirPath(), "federation");
  const deployment_dir = join(root, "deployments", fed_id);
  return {
    deployment_dir,
    releases_dir: join(deployment_dir, "releases"),
    staging_dir: join(deployment_dir, "staging"),
    data_dir: join(root, "data", fed_id),
    config_dir: join(root, "config", fed_id),
    log_path: join(root, "logs", fed_id, "service.log"),
    current_path: join(deployment_dir, "current.json"),
  };
}

/** 创建发布目录；数据和配置目录限制为当前用户可访问。 */
export async function ensure_local_release_paths(paths: LocalReleasePaths): Promise<void> {
  for (const directory of [paths.releases_dir, paths.staging_dir, paths.data_dir, paths.config_dir]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
}

/** 在同一文件系统原子提交完整产物，不覆盖任何已存在 release。 */
export async function install_local_release(staging_dir: string, paths: LocalReleasePaths, release_id: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/u.test(release_id)) throw new Error("Invalid release ID");
  const release_dir = join(paths.releases_dir, release_id);
  // rename 会覆盖空目录，因此先用独占 mkdir 保留目标名称。
  await mkdir(release_dir);
  try {
    await rename(staging_dir, release_dir);
    return release_dir;
  } catch (error) {
    await rm(release_dir, { recursive: true, force: true });
    throw error;
  }
}

/** 只在本次实例已就绪且 registry 已写入后激活版本指针。 */
export async function activate_local_release(paths: LocalReleasePaths, release_id: string): Promise<void> {
  const temporary_path = `${paths.current_path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary_path, `${JSON.stringify({ schema: 1, release_id })}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary_path, paths.current_path);
  } finally {
    await rm(temporary_path, { force: true });
  }
}

/** 读取最后成功激活的发布 ID；失败候选不能被 restart 当作当前版本。 */
export async function read_current_release(paths: LocalReleasePaths): Promise<string> {
  try {
    const current = JSON.parse(await readFile(paths.current_path, "utf8")) as Record<string, unknown>;
    if (current.schema !== 1 || typeof current.release_id !== "string" || !/^[a-zA-Z0-9_-]+$/u.test(current.release_id)) {
      throw new Error("Invalid current release");
    }
    return current.release_id;
  } catch {
    throw new CliError({ title: "No verified current release is installed", note: paths.current_path,
      fix: "Explicitly deploy a release before restarting this Federation." });
  }
}

/** 获取单 Fed 操作锁；无法证明锁可安全回收时直接报告位置，不自动移走别人的锁。 */
export async function with_local_release_lock<T>(fed_id: string, action: () => Promise<T>): Promise<T> {
  local_release_paths(fed_id); // 与安装路径共用 ID 校验，锁目录不能逃逸。
  const lock_dir = join(getPlatformRootDirPath(), "federation", "locks", `${fed_id}.lock`);
  await mkdir(dirname(lock_dir), { recursive: true, mode: 0o700 });
  const owner_path = join(lock_dir, "owner.json");
  const owner_id = randomUUID();
  try {
    await mkdir(lock_dir, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let previous_pid: number;
    try {
      const owner = JSON.parse(await readFile(owner_path, "utf8")) as Record<string, unknown>;
      if (!Number.isSafeInteger(owner.pid) || Number(owner.pid) <= 0) throw new Error("Invalid owner");
      previous_pid = Number(owner.pid);
    } catch {
      throw new CliError({ title: "Federation operation lock has no verifiable owner", note: lock_dir });
    }
    let owner_alive = true;
    try { process.kill(previous_pid, 0); } catch (probe_error) {
      owner_alive = (probe_error as NodeJS.ErrnoException).code !== "ESRCH";
    }
    if (owner_alive) throw new CliError({ title: "Another Federation operation is in progress", note: fed_id });
    throw new CliError({ title: "A stale Federation operation lock needs inspection", note: lock_dir,
      fix: "Verify that no deployment operation is running before removing this stale lock directory." });
  }
  try {
    const file = await open(owner_path, "wx", 0o600);
    try { await file.writeFile(JSON.stringify({ pid: process.pid, owner_id })); } finally { await file.close(); }
  } catch (error) {
    await rm(lock_dir, { recursive: true, force: true });
    throw error;
  }
  try {
    return await action();
  } finally {
    const owner = JSON.parse(await readFile(owner_path, "utf8")) as Record<string, unknown>;
    if (owner.owner_id === owner_id) await rm(lock_dir, { recursive: true, force: true });
  }
}
