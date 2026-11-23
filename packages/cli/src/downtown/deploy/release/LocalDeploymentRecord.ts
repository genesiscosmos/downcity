/**
 * 本地发布尝试记录：发布结果与实时进程状态分别保存。
 *
 * 调用者持有同 Fed 操作锁；每个阶段原子落盘。失败不会覆盖最后成功版本，
 * 原始错误与环境变量不进入记录，清理失败以明确状态呈现，不据此宣称服务已停止。
 */
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { local_release_paths } from "./LocalReleaseStore.js";

/** 发布阶段；准备阶段只做校验，数据准备发生在旧服务停止之后。 */
export type LocalDeploymentPhase = "build" | "package" | "validate" | "install" | "preflight" | "stop" | "prepare" | "start" | "ready" | "activate";

/** 一次发布尝试，只保存身份及结果，不保存运行配置或秘密。 */
export interface LocalDeploymentAttempt {
  /** 本次发布操作唯一身份。 */
  operation_id: string;
  /** 操作开始的 UTC 时间。 */
  started_at: string;
  /** 操作完成的 UTC 时间；进行中不填写。 */
  finished_at?: string;
  /** 最近执行阶段；失败时即失败阶段。 */
  phase: LocalDeploymentPhase;
  /** 本次发布结果；不等于系统进程运行状态。 */
  outcome: "in_progress" | "succeeded" | "failed";
  /** 本次候选版本；构建尚未形成版本时不填写。 */
  release_id?: string;
  /** 是否已开始停止旧实例或修改数据，不能再宣称旧服务保持原状。 */
  cutover_started: boolean;
  /** 是否尝试过启动候选服务；用于区分无需清理与必须确认清理的情况。 */
  candidate_started: boolean;
  /** 失败候选清理结果；unknown 表示不能确认是否仍在运行。 */
  cleanup: "not_required" | "stopped" | "unknown";
}

/** 一个 Fed 的发布历史摘要，不作为运行状态的事实源。 */
export interface LocalDeploymentRecord {
  /** 当前记录协议版本。 */
  schema: 1;
  /** 稳定 Fed 身份。 */
  fed_id: string;
  /** 已进入切换但尚无后续成功发布；新一次预检失败不能清除此恢复保护。 */
  recovery_required: boolean;
  /** 最后一次尝试，进程中断时可保留 in_progress 供人工排查。 */
  latest: LocalDeploymentAttempt;
  /** 最后完成激活的成功尝试，失败不改写。 */
  last_success?: LocalDeploymentAttempt;
  /** 最近一次失败尝试，后续成功也保留供对照。 */
  last_failure?: LocalDeploymentAttempt;
}

/** 当前锁范围内可更新的记录，不共享到其他操作。 */
export interface LocalDeploymentTracker {
  /** 原子写入的部署记录文件。 */
  record_path: string;
  /** 当前内存记录，每次阶段推进都会落盘。 */
  record: LocalDeploymentRecord;
}

const phases: LocalDeploymentPhase[] = ["build", "package", "validate", "install", "preflight", "stop", "prepare", "start", "ready", "activate"];

/** 校验外部读取的尝试结构，避免把损坏记录解释为成功发布。 */
function valid_attempt(value: unknown): value is LocalDeploymentAttempt {
  if (!value || typeof value !== "object") return false;
  const attempt = value as LocalDeploymentAttempt;
  return typeof attempt.operation_id === "string" && !!attempt.operation_id
    && typeof attempt.started_at === "string" && Number.isFinite(Date.parse(attempt.started_at))
    && (attempt.finished_at === undefined || Number.isFinite(Date.parse(attempt.finished_at)))
    && phases.includes(attempt.phase) && ["in_progress", "succeeded", "failed"].includes(attempt.outcome)
    && (attempt.release_id === undefined || typeof attempt.release_id === "string")
    && typeof attempt.cutover_started === "boolean" && typeof attempt.candidate_started === "boolean"
    && ["not_required", "stopped", "unknown"].includes(attempt.cleanup);
}

/** 只读发布摘要；没有记录与损坏记录必须分别处理。 */
export async function read_local_deployment_record(fed_id: string): Promise<LocalDeploymentRecord | undefined> {
  const record_path = join(local_release_paths(fed_id).deployment_dir, "deployment.json");
  try {
    const record = JSON.parse(await readFile(record_path, "utf8")) as LocalDeploymentRecord;
    if (record.schema !== 1 || record.fed_id !== fed_id || typeof record.recovery_required !== "boolean" || !valid_attempt(record.latest)
      || (record.last_success !== undefined && (!valid_attempt(record.last_success) || record.last_success.outcome !== "succeeded"))
      || (record.last_failure !== undefined && (!valid_attempt(record.last_failure) || record.last_failure.outcome !== "failed"))) {
      throw new Error("Invalid deployment record");
    }
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Unable to read Downtown deployment history; inspect deployment.json");
  }
}

/** 已获得独占锁后开始尝试，不因上一次发布失败丢失成功版本。 */
export async function begin_local_deployment(fed_id: string): Promise<LocalDeploymentTracker> {
  const previous = await read_local_deployment_record(fed_id);
  const tracker: LocalDeploymentTracker = {
    record_path: join(local_release_paths(fed_id).deployment_dir, "deployment.json"),
    record: { schema: 1, fed_id, recovery_required: previous?.recovery_required ?? false,
      last_success: previous?.last_success, last_failure: previous?.last_failure,
      latest: { operation_id: randomUUID(), started_at: new Date().toISOString(), phase: "build", outcome: "in_progress",
        cutover_started: false, candidate_started: false, cleanup: "not_required" } },
  };
  await save_record(tracker);
  return tracker;
}

/** 记录下一阶段及有限事实；禁止通过阶段更新提前标记成功或改写历史。 */
export async function advance_local_deployment(tracker: LocalDeploymentTracker, phase: LocalDeploymentPhase,
  facts: Partial<Pick<LocalDeploymentAttempt, "release_id" | "cutover_started" | "candidate_started">> = {}): Promise<void> {
  tracker.record.latest = { ...tracker.record.latest, ...facts, phase };
  if (facts.cutover_started) tracker.record.recovery_required = true;
  await save_record(tracker);
}

/** 完成本次尝试，失败不改变成功记录；cleanup 必须来自实际清理结果。 */
export async function finish_local_deployment(tracker: LocalDeploymentTracker, outcome: "succeeded" | "failed",
  cleanup: LocalDeploymentAttempt["cleanup"] = "not_required"): Promise<void> {
  const attempt = { ...tracker.record.latest, outcome, cleanup, finished_at: new Date().toISOString() };
  tracker.record.latest = attempt;
  if (outcome === "succeeded") {
    tracker.record.last_success = attempt;
    tracker.record.recovery_required = false;
  } else tracker.record.last_failure = attempt;
  await save_record(tracker);
}

/** 只读所有发布尝试，用于可靠区分成功、失败与尚在进行中的产物。 */
export async function read_local_deployment_attempts(fed_id: string): Promise<LocalDeploymentAttempt[]> {
  const attempts_dir = join(local_release_paths(fed_id).deployment_dir, "attempts");
  let names: string[];
  try {
    if (!(await lstat(attempts_dir)).isDirectory()) throw new Error("Invalid attempt directory");
    names = await readdir(attempts_dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const attempts: LocalDeploymentAttempt[] = [];
  for (const name of names.sort()) {
    if (!/^[a-f0-9-]{36}\.json$/u.test(name)) throw new Error("Unexpected file in deployment attempts");
    const file_path = join(attempts_dir, name);
    if (!(await lstat(file_path)).isFile()) throw new Error("Invalid attempt file");
    const attempt: unknown = JSON.parse(await readFile(file_path, "utf8"));
    if (!valid_attempt(attempt) || `${attempt.operation_id}.json` !== name) throw new Error("Invalid deployment attempt");
    attempts.push(attempt);
  }
  return attempts;
}

/** 同目录原子写入；即使失败也保留内存事实，供调用者输出与人工排查。 */
async function save_record(tracker: LocalDeploymentTracker): Promise<void> {
  await mkdir(dirname(tracker.record_path), { recursive: true, mode: 0o700 });
  const attempts_dir = join(dirname(tracker.record_path), "attempts");
  await mkdir(attempts_dir, { recursive: true, mode: 0o700 });
  const attempt_path = join(attempts_dir, `${tracker.record.latest.operation_id}.json`);
  const attempt_temporary = `${attempt_path}.${randomUUID()}.tmp`;
  try {
    await writeFile(attempt_temporary, `${JSON.stringify(tracker.record.latest)}\n`, { flag: "wx", mode: 0o600 });
    await rename(attempt_temporary, attempt_path);
  } finally { await rm(attempt_temporary, { force: true }); }
  const temporary_path = `${tracker.record_path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary_path, `${JSON.stringify(tracker.record)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary_path, tracker.record_path);
  } finally { await rm(temporary_path, { force: true }); }
}
