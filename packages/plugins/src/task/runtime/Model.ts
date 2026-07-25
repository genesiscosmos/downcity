/**
 * Task definition parsing and validation.
 *
 * 关键点（中文）
 * - `task.md` 使用 YAML frontmatter + markdown 正文
 * - frontmatter 必须包含：title/when/description/session_id/status
 * - `when` 统一承载触发语义：`@manual` / cron / `time:<ISO8601-with-timezone>`
 */

import yaml from "js-yaml";
import path from "node:path";
import cron from "node-cron";
import { parseFrontMatter } from "./Frontmatter.js";
import type {
  ShipTaskDefinitionV1,
  ShipTaskFrontmatterV1,
  ShipTaskKind,
  ShipTaskStatus,
} from "@/task/types/Task.js";
import type { JsonObject, JsonValue } from "@downcity/agent";

/**
 * 必填 frontmatter 字段清单。
 */
const REQUIRED_FIELDS: Array<keyof ShipTaskFrontmatterV1> = [
  "title",
  "when",
  "description",
  "session_id",
  "status",
];

type TaskRawValue = JsonValue | undefined;

function normalizeTaskReview(input: TaskRawValue): boolean | null {
  if (typeof input === "boolean") return input;
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  return null;
}

/**
 * cron alias 映射表。
 */
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
  input: TaskRawValue,
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

/**
 * 兼容旧调用名：返回 cron 表达式或 `@manual`。
 */
export function normalizeTaskCronExpression(raw: string): string | null {
  const when = normalizeTaskWhen(raw);
  if (!when.ok) return null;
  if (isTaskWhenOneShot(when.value)) return null;
  return normalizeCronExpression(when.value);
}

export function isTaskWhenManual(input: string): boolean {
  const when = String(input || "").trim().toLowerCase();
  return when === "@manual";
}

export function isTaskWhenOneShot(input: string): boolean {
  const when = String(input || "").trim().toLowerCase();
  return when.startsWith("time:");
}

/**
 * when -> cron expression；非 cron 返回 null。
 */
export function resolveTaskWhenCronExpression(input: string): string | null {
  const normalized = normalizeTaskWhen(input);
  if (!normalized.ok) return null;
  if (isTaskWhenManual(normalized.value)) return null;
  if (isTaskWhenOneShot(normalized.value)) return null;
  return normalizeCronExpression(normalized.value);
}

/**
 * when -> one-shot 毫秒时间戳；非 one-shot 返回 null。
 */
export function resolveTaskWhenOneShotMs(input: string): number | null {
  const normalized = normalizeTaskWhen(input);
  if (!normalized.ok) return null;
  if (!isTaskWhenOneShot(normalized.value)) return null;
  const iso = normalized.value.slice("time:".length).trim();
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || Number.isNaN(ms)) return null;
  return ms;
}

/**
 * 归一化 task 状态。
 */
export function normalizeTaskStatus(input: TaskRawValue): ShipTaskStatus | null {
  const s = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (s === "enabled") return "enabled";
  if (s === "paused") return "paused";
  if (s === "disabled") return "disabled";
  return null;
}

/**
 * 归一化 task 执行类型。
 */
export function normalizeTaskKind(input: TaskRawValue): ShipTaskKind {
  const s = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (s === "script") return "script";
  return "agent";
}

/**
 * 解析 task.md 为结构化定义。
 */
export function parseTaskMarkdown(params: {
  taskId: string;
  markdown: string;
  taskMdPath: string;
  project_root: string;
}): { ok: true; task: ShipTaskDefinitionV1 } | { ok: false; error: string } {
  const { taskId, markdown, taskMdPath, project_root } = params;
  const text = String(markdown ?? "");
  const { frontMatterYaml, body } = parseFrontMatter(text);

  if (!frontMatterYaml || !frontMatterYaml.trim()) {
    return { ok: false, error: "Missing YAML frontmatter (--- ... ---) in task.md" };
  }

  let meta: JsonObject | null = null;
  try {
    const loaded = yaml.load(frontMatterYaml) as JsonValue;
    if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
      meta = loaded as JsonObject;
    } else {
      meta = null;
    }
  } catch (e) {
    return { ok: false, error: `Invalid YAML frontmatter: ${String(e)}` };
  }

  if (!meta || typeof meta !== "object") {
    return { ok: false, error: "Invalid frontmatter: must be a YAML object" };
  }

  // 兼容已有任务定义：若无 when，则按旧字段推导。
  const rawWhen = String(meta.when ?? "").trim();
  if (!rawWhen) {
    const rawTime = String(meta.time ?? "").trim();
    const rawCron = String(meta.cron ?? "").trim();
    if (rawTime) {
      meta.when = `time:${rawTime}`;
    } else if (rawCron) {
      meta.when = rawCron;
    }
  }

  const missing: string[] = [];
  const rawTitle = String(meta?.title ?? "").trim();
  if (!rawTitle) missing.push("title");
  for (const f of REQUIRED_FIELDS.filter((x) => x !== "title")) {
    if (meta?.[f] === undefined || meta?.[f] === null || String(meta?.[f]).trim() === "") {
      missing.push(String(f));
    }
  }
  if (missing.length > 0) {
    return { ok: false, error: `Missing required frontmatter fields: ${missing.join(", ")}` };
  }

  const status = normalizeTaskStatus(meta.status);
  if (!status) {
    return {
      ok: false,
      error: `Invalid status: "${String(meta.status)}" (expected: enabled|paused|disabled)`,
    };
  }

  const whenNormalized = normalizeTaskWhen(meta.when);
  if (!whenNormalized.ok) {
    return { ok: false, error: whenNormalized.error };
  }

  const kind = normalizeTaskKind(meta.kind);
  const body_text = String(body ?? "").trim();
  if (kind === "script" && !body_text) {
    return { ok: false, error: "script task body cannot be empty" };
  }

  const fm: ShipTaskFrontmatterV1 = {
    title: rawTitle,
    when: whenNormalized.value,
    description: String(meta.description).trim(),
    session_id: String(meta.session_id).trim(),
    kind,
    ...(kind === "agent" && normalizeTaskReview(meta.review) === true ? { review: true } : {}),
    status,
  };

  const relTaskMdPath = path
    .relative(project_root, taskMdPath)
    .split(path.sep)
    .join("/");

  const task: ShipTaskDefinitionV1 = {
    v: 1,
    taskId,
    frontmatter: fm,
    body: String(body ?? "").trim(),
    taskMdPath: relTaskMdPath,
  };

  return { ok: true, task };
}

/**
 * 生成 task.md 文本。
 */
export function buildTaskMarkdown(params: {
  frontmatter: ShipTaskFrontmatterV1;
  body: string;
}): string {
  const { frontmatter, body } = params;
  const whenNormalized = normalizeTaskWhen(frontmatter.when);
  if (!whenNormalized.ok) {
    throw new Error(whenNormalized.error);
  }

  const kind = normalizeTaskKind(frontmatter.kind);
  const body_text = String(body ?? "").trim();
  if (kind === "script" && !body_text) {
    throw new Error("script task body cannot be empty");
  }

  const meta = {
    title: String(frontmatter.title || "").trim(),
    when: whenNormalized.value,
    description: String(frontmatter.description || "").trim(),
    session_id: String(frontmatter.session_id || "").trim(),
    kind,
    ...(kind === "agent" ? { review: Boolean(frontmatter.review) } : {}),
    status: String(frontmatter.status || "").trim(),
  };

  const yamlText = yaml.dump(meta, {
    lineWidth: 120,
    noRefs: true,
  });

  const bodyWithTrailingLf = body_text ? body_text + "\n" : "";
  return `---\n${yamlText}---\n\n${bodyWithTrailingLf}`;
}
