/**
 * Control 任务与日志数据 helper。
 *
 * 关键点（中文）
 * - 聚合 logs 与 task runs 读取逻辑。
 * - 仅负责磁盘侧读取与 control UI 视图映射。
 */

import fs from "fs-extra";
import path from "node:path";
import { getLogsDirPath, getDowncityTasksDirPath } from "@/city/config/Paths.js";
import type {
  ControlLogEntry,
  ControlTaskRunDetail,
  ControlTaskRunSummary,
} from "@/city/agent/control/types/ControlViewData.js";
import { truncateText } from "@/city/agent/control/CommonHelpers.js";
import { loadSessionMessagesFromFile, toUiMessageTimeline } from "@/city/agent/control/MessageTimeline.js";

export const TASK_RUN_DIR_REGEX = /^\d{8}-\d{6}-\d{3}$/;
const TASK_ID_REGEXP = /^[\p{L}\p{N}][\p{L}\p{N}_\-\s]{0,63}$/u;

function normalizeTaskId(input: string): string {
  const id = String(input || "").trim();
  if (!TASK_ID_REGEXP.test(id)) {
    throw new Error(`Invalid taskId: "${id}"`);
  }
  return id;
}

function deriveTaskIdFromTitle(title: string): string {
  const normalized = String(title || "")
    .normalize("NFKC")
    .replace(/[\\/:\u0000]/g, " ")
    .replace(/[^\p{L}\p{N}_\-\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)
    .trim();
  return normalizeTaskId(normalized);
}

/**
 * 读取近期日志。
 */
export async function readRecentLogs(params: {
  data_path: string;
  limit: number;
}): Promise<ControlLogEntry[]> {
  const logsDir = getLogsDirPath(params.data_path);
  if (!(await fs.pathExists(logsDir))) return [];

  const files = (await fs.readdir(logsDir, { withFileTypes: true }))
    .filter((x) => x.isFile() && x.name.endsWith(".jsonl"))
    .map((x) => x.name)
    .sort()
    .reverse();

  const out: ControlLogEntry[] = [];

  for (const fileName of files) {
    if (out.length >= params.limit) break;
    const abs = path.join(logsDir, fileName);
    const raw = await fs.readFile(abs, "utf-8").catch(() => "");
    const lines = raw.split("\n").filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (out.length >= params.limit) break;
      try {
        const parsed = JSON.parse(lines[index]) as ControlLogEntry;
        if (!parsed || typeof parsed !== "object") continue;
        out.push({
          ...(typeof parsed.timestamp === "string" ? { timestamp: parsed.timestamp } : {}),
          ...(typeof parsed.type === "string" ? { type: parsed.type } : {}),
          ...(typeof parsed.level === "string" ? { level: parsed.level } : {}),
          ...(typeof parsed.message === "string" ? { message: parsed.message } : {}),
          ...(parsed.details && typeof parsed.details === "object"
            ? { details: parsed.details }
            : {}),
        });
      } catch {
        // ignore
      }
    }
  }

  return out;
}

async function resolveTaskDir(data_path: string, title: string): Promise<string> {
  const taskId = deriveTaskIdFromTitle(title);
  return path.join(getDowncityTasksDirPath(data_path), taskId);
}

/**
 * 枚举任务运行摘要。
 */
export async function listTaskRuns(params: {
  data_path: string;
  title: string;
  limit: number;
}): Promise<ControlTaskRunSummary[]> {
  const taskDir = await resolveTaskDir(params.data_path, params.title);
  if (!(await fs.pathExists(taskDir))) return [];

  const entries = await fs.readdir(taskDir, { withFileTypes: true });
  const timestamps = entries
    .filter((x) => x.isDirectory() && TASK_RUN_DIR_REGEX.test(x.name))
    .map((x) => x.name)
    .sort()
    .reverse()
    .slice(0, params.limit);

  const out: ControlTaskRunSummary[] = [];

  for (const timestamp of timestamps) {
    const runDir = path.join(taskDir, timestamp);
    const metaPath = path.join(runDir, "run.json");
    const progressPath = path.join(runDir, "run-progress.json");
    const runDirRel = path.relative(params.data_path, runDir).split(path.sep).join("/");
    const meta = (await fs.readJson(metaPath).catch(() => null)) as {
      status?: string;
      executionStatus?: string;
      resultStatus?: string;
      startedAt?: number;
      endedAt?: number;
      dialogueRounds?: number;
      userSimulatorSatisfied?: boolean;
      error?: string;
    } | null;
    const progress = (await fs.readJson(progressPath).catch(() => null)) as {
      status?: string;
      phase?: string;
      message?: string;
      updated_at?: number;
      round?: number;
      maxRounds?: number;
    } | null;

    const progressStatus =
      typeof progress?.status === "string" ? progress.status : undefined;
    const inProgress =
      progressStatus === "running" ||
      (!meta && (await fs.pathExists(progressPath)));
    const displayStatus =
      inProgress
        ? "running"
        : typeof meta?.status === "string"
          ? meta.status
          : progressStatus;

    out.push({
      timestamp,
      ...(typeof displayStatus === "string" ? { status: displayStatus } : {}),
      ...(typeof meta?.executionStatus === "string" ? { executionStatus: meta.executionStatus } : {}),
      ...(typeof meta?.resultStatus === "string" ? { resultStatus: meta.resultStatus } : {}),
      ...(inProgress ? { inProgress: true } : {}),
      ...(typeof progress?.phase === "string" ? { progressPhase: progress.phase } : {}),
      ...(typeof progress?.message === "string" ? { progressMessage: progress.message } : {}),
      ...(typeof progress?.updated_at === "number" ? { progressUpdatedAt: progress.updated_at } : {}),
      ...(typeof progress?.round === "number" ? { progressRound: progress.round } : {}),
      ...(typeof progress?.maxRounds === "number" ? { progressMaxRounds: progress.maxRounds } : {}),
      ...(typeof meta?.startedAt === "number" ? { startedAt: meta.startedAt } : {}),
      ...(typeof meta?.endedAt === "number" ? { endedAt: meta.endedAt } : {}),
      ...(typeof meta?.dialogueRounds === "number" ? { dialogueRounds: meta.dialogueRounds } : {}),
      ...(typeof meta?.userSimulatorSatisfied === "boolean"
        ? { userSimulatorSatisfied: meta.userSimulatorSatisfied }
        : {}),
      ...(typeof meta?.error === "string" ? { error: meta.error } : {}),
      runDirRel,
    });
  }

  return out;
}

/**
 * 读取任务运行详情。
 */
export async function readTaskRunDetail(params: {
  data_path: string;
  title: string;
  timestamp: string;
}): Promise<ControlTaskRunDetail | null> {
  const taskDir = await resolveTaskDir(params.data_path, params.title);
  const runDir = path.join(taskDir, params.timestamp);
  if (!(await fs.pathExists(runDir))) return null;

  const readText = async (name: string, maxChars = 80_000): Promise<string | undefined> => {
    const abs = path.join(runDir, name);
    if (!(await fs.pathExists(abs))) return undefined;
    const raw = await fs.readFile(abs, "utf-8").catch(() => "");
    return truncateText(raw, maxChars);
  };

  const readJson = async <T>(name: string): Promise<T | undefined> => {
    const abs = path.join(runDir, name);
    if (!(await fs.pathExists(abs))) return undefined;
    return (await fs.readJson(abs).catch(() => undefined)) as T | undefined;
  };

  const messagesPath = path.join(runDir, "messages.jsonl");
  const messages = await loadSessionMessagesFromFile(messagesPath);
  const progress = await readJson<{
    status?: string;
    phase?: string;
    message?: string;
    startedAt?: number;
    updated_at?: number;
    endedAt?: number;
    round?: number;
    maxRounds?: number;
    runStatus?: string;
    executionStatus?: string;
    resultStatus?: string;
    events?: Array<{
      at?: number;
      phase?: string;
      message?: string;
      round?: number;
      maxRounds?: number;
    }>;
  }>("run-progress.json");
  const outputText = (await readText("output.md")) || (await readText("result.md"));

  return {
    title: params.title,
    timestamp: params.timestamp,
    runDirRel: path.relative(params.data_path, runDir).split(path.sep).join("/"),
    meta: await readJson<Record<string, unknown>>("run.json"),
    ...(progress ? { progress } : {}),
    dialogue: await readJson<Record<string, unknown>>("dialogue.json"),
    artifacts: {
      input: await readText("input.md"),
      output: outputText,
      result: await readText("result.md"),
      dialogue: await readText("dialogue.md"),
      error: await readText("error.md"),
    },
    messages: messages.slice(-120).flatMap((message) => toUiMessageTimeline(message)),
  };
}
