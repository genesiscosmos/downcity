/**
 * `task.toml` 与领域对象之间的唯一映射。
 *
 * ## 为什么文件 schema 只在这里
 *
 * 文件里的键名与领域属性**不是一回事**：`prompt` 对内部的 `body`，
 * `schedule` 对内部的 `schedule`，`workflow.progress` 对内部的工作进度。
 * 把这份映射集中在这里，是为了让「磁盘上的任务长什么样」只有一个答案，
 * 而不是让每个消费方各自读字段拼出一个自己的版本。
 *
 * ## 分段写入
 *
 * TOML 要求根级标量必须出现在任何表之前，因此写入顺序固定为
 * 标量 → 多行文本 → 单表 → 数组表（见 `build_task_document`）。
 * 多行正文用字面量字符串（`'''`），反斜杠与引号无需转义。
 *
 * ## 解析只做两件事
 *
 * `parse_task_document` 只负责「文本 → 无类型结构」，本模块负责
 * 「结构 → 领域对象」并给出可读的校验错误。两件事分开，失败原因才不会混在
 * 「文件不是 TOML」和「字段值不合法」之间。
 */

import path from "node:path";
import cron from "node-cron";
import { z } from "zod";
import { build_task_document, parse_task_document } from "./TaskDocument.js";
import { task_preparation_schema } from "./TaskPreparationSchema.js";
import { normalize_task_state } from "./TaskWorkflowModel.js";
import type {
  ShipTaskDefinitionV1,
  ShipTaskKind,
  ShipTaskStatus,
  TaskDeliverySession,
} from "@/task/types/Task.js";

/** 文件里必填的标量键；缺失即定义不可用。 */
const REQUIRED_KEYS = ["title", "when"] as const;

/** 解析入口能拿到的原始值；文件结构未经校验，一律按 unknown 处理。 */
type RawValue = unknown;

/** cron alias 映射表。 */
const CRON_ALIAS_TO_EXPRESSION: Record<string, string> = {
  "@manual": "@manual",
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};

const ISO_DATETIME_WITH_TZ_REGEXP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const ISO_DATETIME_WITHOUT_TZ_REGEXP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/i;

/** 校验并归一化 Task 的固定 Session 交付目标。 */
function normalize_task_delivery_session(
  input: RawValue,
): { ok: true; value?: TaskDeliverySession } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid delivery_session: expected a table" };
  }
  const value = input as Record<string, unknown>;
  const agent_id = String(value.agent_id ?? "").trim();
  const workspace_id = String(value.workspace_id ?? "").trim();
  const session_id = String(value.session_id ?? "").trim();
  const category = String(value.category ?? "").trim();
  if (!agent_id || !session_id || !category) {
    return {
      ok: false,
      error: "Invalid delivery_session: agent_id, session_id and category are required",
    };
  }
  return { ok: true, value: { agent_id, workspace_id: workspace_id || null, session_id, category } };
}

/** 解析布尔型字段，兼容字符串写法以容忍手写文件。 */
function normalize_boolean(input: RawValue): boolean | undefined {
  if (typeof input === "boolean") return input;
  if (typeof input !== "string") return undefined;
  const value = input.trim().toLowerCase();
  if (!value) return undefined;
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  return undefined;
}

function normalizeCronExpression(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  return CRON_ALIAS_TO_EXPRESSION[lower] || value;
}

function normalizeOneShotTime(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = String(raw || "").trim();
  if (!value) {
    return {
      ok: false,
      error:
        "Invalid when time: expected ISO8601 datetime with timezone, e.g. 2026-03-08T10:30:00+08:00 or Z",
    };
  }
  if (!ISO_DATETIME_WITH_TZ_REGEXP.test(value)) {
    return {
      ok: false,
      error:
        `Invalid when time: "${value}" (expected ISO8601 datetime with timezone, e.g. 2026-03-08T10:30:00+08:00 or Z)`,
    };
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || Number.isNaN(ms)) {
    return {
      ok: false,
      error:
        `Invalid when time: "${value}" (expected ISO8601 datetime with timezone, e.g. 2026-03-08T10:30:00+08:00 or Z)`,
    };
  }
  return { ok: true, value: new Date(ms).toISOString() };
}

/**
 * 校验并归一化 when。
 *
 * 规则（中文）
 * - `@manual`
 * - cron / alias
 * - `time:<ISO8601-with-timezone>`（一次性触发）
 * - 兼容裸 ISO 时间输入，会归一化为 `time:<iso>`
 */
export function normalizeTaskWhen(
  input: RawValue,
): { ok: true; value: string } | { ok: false; error: string } {
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, error: "when cannot be empty" };

  const lower = raw.toLowerCase();
  if (lower === "@manual") return { ok: true, value: "@manual" };

  if (lower.startsWith("time:")) {
    const timeRaw = raw.slice(raw.indexOf(":") + 1).trim();
    const normalized = normalizeOneShotTime(timeRaw);
    if (!normalized.ok) return normalized;
    return { ok: true, value: `time:${normalized.value}` };
  }

  if (ISO_DATETIME_WITH_TZ_REGEXP.test(raw)) {
    const normalized = normalizeOneShotTime(raw);
    if (!normalized.ok) return normalized;
    return { ok: true, value: `time:${normalized.value}` };
  }

  if (ISO_DATETIME_WITHOUT_TZ_REGEXP.test(raw)) {
    return {
      ok: false,
      error:
        `Invalid when time: "${raw}" (expected ISO8601 datetime with timezone, e.g. 2026-03-08T10:30:00+08:00 or Z)`,
    };
  }

  const cronExpression = normalizeCronExpression(raw);
  if (!cronExpression) return { ok: false, error: "when cannot be empty" };
  const canonical = CRON_ALIAS_TO_EXPRESSION[lower] ? lower : raw;
  if (cronExpression !== "@manual" && !cron.validate(cronExpression)) {
    return { ok: false, error: `Invalid when (cron): "${raw}"` };
  }
  return { ok: true, value: canonical };
}

export function isTaskWhenManual(input: string): boolean {
  const when = String(input || "").trim().toLowerCase();
  return when === "@manual";
}

export function isTaskWhenOneShot(input: string): boolean {
  const when = String(input || "").trim().toLowerCase();
  return when.startsWith("time:");
}

/** when -> cron expression；非 cron 返回 null。 */
export function resolveTaskWhenCronExpression(input: string): string | null {
  const normalized = normalizeTaskWhen(input);
  if (!normalized.ok) return null;
  if (isTaskWhenManual(normalized.value)) return null;
  if (isTaskWhenOneShot(normalized.value)) return null;
  return normalizeCronExpression(normalized.value);
}

/** when -> one-shot 毫秒时间戳；非 one-shot 返回 null。 */
export function resolveTaskWhenOneShotMs(input: string): number | null {
  const normalized = normalizeTaskWhen(input);
  if (!normalized.ok) return null;
  if (!isTaskWhenOneShot(normalized.value)) return null;
  const iso = normalized.value.slice("time:".length).trim();
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || Number.isNaN(ms)) return null;
  return ms;
}

/** 归一化调度启停状态；未知值明确失败，避免把拼错当成启用。 */
export function normalizeTaskSchedule(input: RawValue): ShipTaskStatus | null {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (!value) return "enabled";
  if (value === "enabled") return "enabled";
  if (value === "paused") return "paused";
  return null;
}

/** 归一化执行类型；省略时按 Agent 执行处理。 */
export function normalizeTaskKind(input: RawValue): ShipTaskKind {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (value === "user" || value === "script") return value;
  return "agent";
}

/** 解析参数。 */
export interface ParseTaskDefinitionParams {
  /** Task 聚合目录使用的稳定 ID。 */
  taskId: string;
  /** `task.toml` 原文。 */
  text: string;
  /** `task.toml` 的绝对路径，用于计算相对路径。 */
  task_file_path: string;
  /** PowerStorage 根路径。 */
  data_path: string;
}

/**
 * 解析 `task.toml` 为结构化定义。
 *
 * 失败一律返回 `{ ok: false, error }`，不抛异常：损坏的定义必须能作为可观察的
 * issue 展示，而不是让整个 Store 扫描中断。
 */
export function parseTaskDefinition(
  params: ParseTaskDefinitionParams,
): { ok: true; task: ShipTaskDefinitionV1 } | { ok: false; error: string } {
  const parsed = parse_task_document(params.text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const document = parsed.document;
  const scalars = document.scalars;

  const missing = REQUIRED_KEYS.filter((key) => {
    const value = scalars[key];
    return value === undefined || value === null || String(value).trim() === "";
  });
  if (missing.length > 0) {
    return { ok: false, error: `Missing required fields: ${missing.join(", ")}` };
  }

  const when = normalizeTaskWhen(scalars.when);
  if (!when.ok) return { ok: false, error: when.error };

  const schedule = normalizeTaskSchedule(scalars.schedule);
  if (!schedule) {
    return {
      ok: false,
      error: `Invalid schedule: "${String(scalars.schedule)}" (expected: enabled|paused)`,
    };
  }

  const kind = normalizeTaskKind(scalars.kind);
  const delivery_session = normalize_task_delivery_session(document.tables.delivery_session);
  if (!delivery_session.ok) return { ok: false, error: delivery_session.error };

  const body = document.multiline.prompt ?? "";
  if (kind === "script" && !body.trim()) {
    return { ok: false, error: "script task prompt cannot be empty" };
  }

  let preparation: ShipTaskDefinitionV1["preparing"];
  try {
    if (document.tables.preparing !== undefined) {
      preparation = task_preparation_schema.parse(document.tables.preparing);
    }
  } catch (error) {
    return { ok: false, error: `Invalid preparing: ${String(error)}` };
  }

  let workflow;
  try {
    workflow = normalize_task_state({
      ...(document.tables.workflow ?? {}),
      occurrences: document.arrays.occurrences ?? [],
      inbox: document.arrays.inbox ?? [],
    });
  } catch (error) {
    return { ok: false, error: `Invalid workflow: ${String(error)}` };
  }

  const task_path = path
    .relative(params.data_path, params.task_file_path)
    .split(path.sep)
    .join("/");

  return {
    ok: true,
    task: {
      taskId: params.taskId,
      title: String(scalars.title ?? "").trim(),
      when: when.value,
      kind,
      agent_id: String(scalars.agent_id ?? "").trim(),
      workspace_id: String(scalars.workspace_id ?? "").trim(),
      ...(delivery_session.value ? { delivery_session: delivery_session.value } : {}),
      ...(kind === "agent" && normalize_boolean(scalars.review) === true ? { review: true } : {}),
      ...(document.multiline.source ? { source: document.multiline.source } : {}),
      ...(scalars.submission_id ? { submission_id: String(scalars.submission_id).trim() } : {}),
      ...(scalars.source_agent_id ? { source_agent_id: String(scalars.source_agent_id).trim() } : {}),
      ...(preparation ? { preparing: preparation } : {}),
      body,
      workflow,
      schedule,
      taskPath: task_path,
    },
  };
}

/**
 * 生成 `task.toml` 原文。
 *
 * 写入时统一刷新 `workflow.updated_at`：它是「最近一次修改」的唯一定义处，
 * 让每个调用方都可能忘记维护它才是真正的坑。
 */
export function buildTaskToml(task: ShipTaskDefinitionV1): string {
  const when = normalizeTaskWhen(task.when);
  if (!when.ok) throw new Error(when.error);
  const schedule = normalizeTaskSchedule(task.schedule);
  if (!schedule) throw new Error(`Invalid schedule: ${task.schedule}`);
  const kind = normalizeTaskKind(task.kind);
  const delivery_session = normalize_task_delivery_session(task.delivery_session);
  if (!delivery_session.ok) throw new Error(delivery_session.error);

  const body = String(task.body ?? "").trim();
  if (kind === "script" && !body) throw new Error("script task prompt cannot be empty");

  const workflow = normalize_task_state(task.workflow);
  const { occurrences, inbox, ...workflow_fields } = workflow;

  return build_task_document({
    scalars: {
      title: String(task.title || "").trim(),
      when: when.value,
      kind,
      schedule,
      agent_id: String(task.agent_id || "").trim() || undefined,
      workspace_id: String(task.workspace_id || "").trim() || undefined,
      review: kind === "agent" ? Boolean(task.review) : undefined,
      submission_id: task.submission_id?.trim() || undefined,
      source_agent_id: task.source_agent_id?.trim() || undefined,
    },
    multiline: [
      { key: "prompt", value: body },
      { key: "source", value: String(task.source ?? "").trim() },
    ],
    tables: [
      ...(delivery_session.value
        ? [{ key: "delivery_session", value: { ...delivery_session.value, workspace_id: delivery_session.value.workspace_id ?? "" } }]
        : []),
      ...(task.preparing ? [{ key: "preparing", value: task_preparation_schema.parse(task.preparing) }] : []),
      { key: "workflow", value: { ...workflow_fields, updated_at: new Date().toISOString() } },
    ],
    arrays: [
      { key: "occurrences", value: occurrences as unknown as Array<Record<string, unknown>> },
      { key: "inbox", value: inbox as unknown as Array<Record<string, unknown>> },
    ],
  });
}
