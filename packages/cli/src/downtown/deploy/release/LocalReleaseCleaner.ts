/**
 * 本地 release 显式清理：同 Fed 操作锁覆盖预览、确认与删除。
 *
 * 保留最近三个成功版本以及全部控制面引用。缺失可信发布结果、损坏 manifest、
 * 无法确认清理的候选均不删除；系统归属或保护记录不能核实时拒绝操作。
 * 删除范围仅限 releases 的直接子目录，不读取或删除数据、配置、日志和部署历史。
 */
import { lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { read_server_by_fed_id, type ServerProfile } from "@/downtown/core/session.js";
import { inspect_release_process } from "./LocalReleaseProcess.js";
import { verify_node_release } from "./NodeReleaseBuilder.js";
import { local_release_paths, read_current_release, with_local_release_lock } from "./LocalReleaseStore.js";
import { read_local_deployment_record, read_local_deployment_attempts, type LocalDeploymentAttempt } from "./LocalDeploymentRecord.js";
import { read_service_config, service_runtime_paths } from "../process/ServiceRuntime.js";
import { resolve_downtown_target, type DowntownTargetOptions } from "../../server/DowntownTarget.js";
import { confirm, isCancel } from "../../tui/Prompts.js";
import { CliError } from "@/shared/CliError.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";

/** 显式清理参数，默认必须交互确认。 */
export interface DowntownCleanOptions extends DowntownTargetOptions {
  /** 只展示清单，不删除。 */
  dry_run?: boolean;
  /** 用户显式同意删除已展示候选，用于非交互自动化。 */
  yes?: boolean;
}

/** 一个直接子目录或异常条目的清理判断。 */
export interface LocalReleaseCleanItem {
  /** releases 下的直接条目名称。 */
  release_id: string;
  /** 文件占用字节；符号链接不跟随，不重复统计外部依赖。 */
  bytes: number;
  /** 是否满足本次删除条件。 */
  remove: boolean;
  /** 保留或删除的可读原因。 */
  reason: string;
}

/** 完整预览；调用者不应在没有重新核对保护引用的情况下执行删除。 */
export interface LocalReleaseCleanPlan {
  /** 精确目标 Fed ID。 */
  fed_id: string;
  /** 经过校验的 releases 目录绝对路径。 */
  releases_dir: string;
  /** 所有直接条目的判断，包含保留项。 */
  items: LocalReleaseCleanItem[];
}

/** 解析本次对象，展示清单；确认前后均在同一部署锁内。 */
export async function run_downtown_clean(options: DowntownCleanOptions): Promise<void> {
  const selected = await resolve_downtown_target(options);
  if (!selected) return;
  if (selected.target !== "local" || !selected.fed_id) throw new CliError({ title: "Release cleanup requires a registered local Downtown" });
  await with_local_release_lock(selected.fed_id, async () => {
    const server = read_server_by_fed_id(selected.fed_id!, "local");
    if (!server || server.base_url !== selected.base_url) throw new CliError({ title: "Downtown deployment changed; select it again" });
    const plan = await plan_local_release_cleanup(server);
    emitCliBlock({ title: "Downtown release cleanup", facts: [
      { label: "name", value: server.name }, { label: "id", value: plan.fed_id },
      { label: "url", value: server.base_url }, { label: "retention", value: "latest 3 successful releases, plus protected references" },
    ] });
    emitCliList({ title: "Release plan", items: plan.items.map((item) => ({
      title: item.release_id, tone: item.remove ? "warning" : "info",
      facts: [{ label: "action", value: item.remove ? "delete" : "keep" },
        { label: "bytes", value: String(item.bytes) }, { label: "reason", value: item.reason }],
    })) });
    const candidates = plan.items.filter((item) => item.remove);
    if (options.dry_run || !candidates.length) return;
    if (!options.yes) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new CliError({
        title: "Cleanup confirmation is required", fix: "Use --dry-run to preview or --yes to explicitly confirm deletion." });
      const accepted = await confirm({ message: `Delete ${candidates.length} release directories (${candidates.reduce((sum, item) => sum + item.bytes, 0)} bytes)?`, initialValue: false });
      if (isCancel(accepted) || accepted !== true) return;
    }
    const refreshed = await plan_local_release_cleanup(server);
    if (JSON.stringify(refreshed) !== JSON.stringify(plan)) throw new CliError({ title: "Release cleanup plan changed; inspect it again" });
    let removed = 0;
    for (const item of candidates) {
      const target = join(plan.releases_dir, item.release_id);
      const stat = await lstat(target);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CliError({ title: "Release directory changed during cleanup" });
      try { await rm(target, { recursive: true }); removed++; }
      catch { throw new CliError({ title: "Release cleanup stopped after a deletion error",
        note: `${removed} release directories deleted; failed at ${item.release_id}. Inspect and rerun cleanup.` }); }
    }
    emitCliBlock({ tone: "success", title: "Release cleanup completed", facts: [{ label: "deleted releases", value: String(removed) }] });
  });
}

/** 只读生成清单；只在发布记录与产物身份一致时允许删除。 */
export async function plan_local_release_cleanup(server: ServerProfile): Promise<LocalReleaseCleanPlan> {
  if (!server.fed_id || server.target !== "local") throw new Error("A registered local Downtown is required");
  const fed_id = server.fed_id;
  const paths = local_release_paths(fed_id);
  // 即使服务已停止，恢复中的进程也可能即将读取产物，必须先核对托管器归属。
  await inspect_release_process(server);
  const protected_ids = new Map<string, string[]>();
  const protect = (id: string | undefined, reason: string) => {
    if (!id) return;
    protected_ids.set(id, [...(protected_ids.get(id) ?? []), reason]);
  };
  protect(server.release_id, "registered deployment reference");
  const current_exists = await exists(join(paths.deployment_dir, "current.json"));
  if (current_exists) {
    if (!(await lstat(join(paths.deployment_dir, "current.json"))).isFile()) throw new Error("Invalid activation pointer");
    protect(await read_current_release(paths), "current activation");
  }
  const launch_path = service_runtime_paths(fed_id).config_path;
  if (await exists(launch_path)) {
    if (!(await lstat(launch_path)).isFile()) throw new Error("Invalid service launch file");
    const config = await read_service_config(launch_path);
    if (config.fed_id !== fed_id) throw new Error("System service launch identity mismatch");
    protect(config.release_id, "system service launch reference");
  }
  const record = await read_local_deployment_record(fed_id);
  const attempts = await read_local_deployment_attempts(fed_id);
  for (const attempt of [record?.latest, record?.last_success, record?.last_failure]) {
    // 两份原子文件可能因进程中断停在不同阶段；保留两者的保护事实，不能忽略 in_progress。
    if (attempt && !attempts.some((entry) => JSON.stringify(entry) === JSON.stringify(attempt))) attempts.push(attempt);
  }
  for (const attempt of attempts) {
    if (attempt.outcome === "in_progress") protect(attempt.release_id, "unfinished deployment reference");
    if (attempt.cleanup === "unknown") protect(attempt.release_id, "candidate cleanup not verified");
  }
  const successful = attempts.filter((attempt) => attempt.outcome === "succeeded" && attempt.release_id)
    .sort((left, right) => Date.parse(right.finished_at ?? right.started_at) - Date.parse(left.finished_at ?? left.started_at)
      || right.operation_id.localeCompare(left.operation_id));
  const retained = new Set<string>();
  for (const attempt of successful) {
    if (retained.size >= 3) break;
    retained.add(attempt.release_id!);
  }
  for (const id of retained) protect(id, "latest 3 successful releases");
  const items: LocalReleaseCleanItem[] = [];
  if (!await exists(paths.releases_dir)) return { fed_id, releases_dir: paths.releases_dir, items };
  const directory_stat = await lstat(paths.releases_dir);
  if (!directory_stat.isDirectory() || directory_stat.isSymbolicLink()) throw new Error("Invalid releases directory");
  const canonical_dir = await realpath(paths.releases_dir);
  for (const name of (await readdir(canonical_dir)).sort()) {
    const filename = join(canonical_dir, name);
    const stat = await lstat(filename);
    if (!/^[a-zA-Z0-9_-]+$/u.test(name) || !stat.isDirectory() || stat.isSymbolicLink()) {
      items.push({ release_id: name, bytes: 0, remove: false, reason: "unrecognized release entry" }); continue;
    }
    const bytes = await directory_bytes(filename);
    let valid = false;
    try {
      const manifest_path = join(filename, "release.json");
      if (!(await lstat(manifest_path)).isFile()) throw new Error("Invalid manifest file");
      const manifest = JSON.parse(await readFile(manifest_path, "utf8")) as Record<string, unknown>;
      valid = manifest.schema === 1 && manifest.fed_id === fed_id && manifest.release_id === name
        && manifest.entry === "app/index.mjs" && typeof manifest.files_digest === "string" && /^[a-f0-9]{64}$/u.test(manifest.files_digest);
    } catch { /* 无可信产物身份的目录只保留，不猜测归属。 */ }
    const history = attempts.filter((attempt) => attempt.release_id === name);
    const completed = history.some((attempt) => attempt.outcome === "succeeded" || attempt.outcome === "failed");
    const reasons = protected_ids.get(name);
    if (valid && completed && !reasons) {
      try { await verify_node_release(filename, fed_id, name); }
      catch { valid = false; }
    }
    items.push({ release_id: name, bytes, remove: valid && completed && !reasons,
      reason: reasons?.join("; ") ?? (!valid ? "invalid or unverified release manifest" : !completed
        ? "no completed deployment history" : history.some(is_success) ? "successful release outside retention" : "failed release eligible for explicit cleanup") });
  }
  return { fed_id, releases_dir: canonical_dir, items };
}

/** 使用 lstat 核对存在性，不把权限错误等同于文件不存在。 */
async function exists(file_path: string): Promise<boolean> {
  try { await lstat(file_path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** 判断历史是否记录过成功发布。 */
function is_success(attempt: LocalDeploymentAttempt): boolean { return attempt.outcome === "succeeded"; }

/** 统计目录占用，不跟随任何软链接。 */
async function directory_bytes(directory: string): Promise<number> {
  let bytes = 0;
  for (const name of await readdir(directory)) {
    const file_path = join(directory, name);
    const stat = await lstat(file_path);
    if (stat.isSymbolicLink()) continue;
    bytes += stat.isDirectory() ? await directory_bytes(file_path) : stat.size;
  }
  return bytes;
}
