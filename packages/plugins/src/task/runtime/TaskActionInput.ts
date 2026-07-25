/**
 * TaskActionInput：task plugin runtime 的 CLI 输入映射模块。
 *
 * 关键点（中文）
 * - 统一处理命令行到 task action payload 的转换。
 * - 参数校验尽量前置到输入层，避免进入执行层后才发现字段非法。
 */

import { resolve_session_id } from "@downcity/agent";
import type { JsonValue } from "@downcity/agent";
import type { PluginActionCommandInput } from "@downcity/agent";
import type { ShipTaskKind, ShipTaskStatus } from "@/task/types/Task.js";
import type {
  TaskCreateRequest,
  TaskDeleteRequest,
  TaskRunRequest,
  TaskSetStatusRequest,
  TaskUpdateRequest,
} from "@/task/types/TaskCommand.js";
import type { TaskListActionPayload } from "@/task/types/TaskPluginTypes.js";

function parseBooleanLike(value: JsonValue | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function getStringOpt(
  opts: Record<string, JsonValue>,
  key: string,
): string | undefined {
  const value = opts[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function getBooleanOpt(
  opts: Record<string, JsonValue>,
  key: string,
): boolean | undefined {
  const value = opts[key];
  return typeof value === "boolean" ? value : undefined;
}

function getBooleanLikeOpt(
  opts: Record<string, JsonValue>,
  key: string,
): boolean | undefined {
  return parseBooleanLike(opts[key]);
}

function readTaskStatusOrThrow(value?: string): ShipTaskStatus | undefined {
  if (!value) return undefined;
  if (value === "enabled" || value === "paused" || value === "disabled") {
    return value;
  }
  throw new Error(`Invalid task status: ${value}`);
}

function readTaskKindOrThrow(value?: string): ShipTaskKind | undefined {
  if (!value) return undefined;
  if (value === "agent" || value === "script") {
    return value;
  }
  throw new Error(`Invalid task kind: ${value}`);
}

function resolveSessionIdOrThrow(input?: string): string {
  const session_id = resolve_session_id({ session_id: input });
  if (!session_id) {
    throw new Error(
      "Missing session_id. Provide --session-id or ensure DC_SESSION_ID is available.",
    );
  }
  return session_id;
}

function mapTaskListCommandInput(
  opts: Record<string, JsonValue>,
): TaskListActionPayload {
  const status = readTaskStatusOrThrow(getStringOpt(opts, "status"));
  return status ? { status } : {};
}

function mapTaskCreateCommandInput(
  opts: Record<string, JsonValue>,
): TaskCreateRequest {
  const title = String(getStringOpt(opts, "title") || "").trim();
  const description = String(getStringOpt(opts, "description") || "").trim();
  if (!title) throw new Error("Missing title");
  if (!description) throw new Error("Missing description");

  const session_id = resolveSessionIdOrThrow(getStringOpt(opts, "session_id"));
  const kind = readTaskKindOrThrow(getStringOpt(opts, "kind"));
  const review = getBooleanLikeOpt(opts, "review");
  const status = readTaskStatusOrThrow(getStringOpt(opts, "status"));
  const activate = getBooleanOpt(opts, "activate") === true;
  if (activate && status && status !== "enabled") {
    throw new Error("`--activate` conflicts with `--status` unless status=enabled");
  }
  const resolvedStatus = activate ? "enabled" : status;

  return {
    title,
    when: String(getStringOpt(opts, "when") || "@manual").trim() || "@manual",
    description,
    session_id,
    ...(kind ? { kind } : {}),
    ...(typeof review === "boolean" ? { review } : {}),
    ...(resolvedStatus ? { status: resolvedStatus } : {}),
    ...(typeof getStringOpt(opts, "body") === "string"
      ? { body: getStringOpt(opts, "body") }
      : {}),
    overwrite: getBooleanOpt(opts, "overwrite") === true,
  };
}

function mapTaskUpdateCommandInput(params: {
  title: string;
  opts: Record<string, JsonValue>;
}): TaskUpdateRequest {
  const opts = params.opts;
  const kind = readTaskKindOrThrow(getStringOpt(opts, "kind"));
  const review = getBooleanLikeOpt(opts, "review");
  const status = readTaskStatusOrThrow(getStringOpt(opts, "status"));
  const activate = getBooleanOpt(opts, "activate") === true;

  // 关键点（中文）：set 与 clear 选项互斥，提前在命令入口做校验。
  const conflicts: string[] = [];
  if (
    typeof getStringOpt(opts, "body") === "string" &&
    getBooleanOpt(opts, "clearBody")
  ) {
    conflicts.push("`--body` conflicts with `--clear-body`");
  }
  if (
    typeof getStringOpt(opts, "when") === "string" &&
    getBooleanOpt(opts, "clearWhen")
  ) {
    conflicts.push("`--when` conflicts with `--clear-when`");
  }
  if (activate && status && status !== "enabled") {
    conflicts.push("`--activate` conflicts with `--status` unless status=enabled");
  }
  if (conflicts.length > 0) {
    throw new Error(conflicts.join("; "));
  }
  const resolvedStatus = activate ? "enabled" : status;

  const hasUpdate =
    typeof getStringOpt(opts, "title") === "string" ||
    typeof getStringOpt(opts, "when") === "string" ||
    typeof getStringOpt(opts, "description") === "string" ||
    typeof getStringOpt(opts, "session_id") === "string" ||
    typeof kind === "string" ||
    typeof review === "boolean" ||
    getBooleanOpt(opts, "clearWhen") === true ||
    typeof resolvedStatus === "string" ||
    typeof getStringOpt(opts, "body") === "string" ||
    getBooleanOpt(opts, "clearBody") === true;

  if (!hasUpdate) {
    throw new Error("No update fields provided");
  }

  return {
    title: String(params.title || "").trim(),
    ...(typeof getStringOpt(opts, "title") === "string"
      ? { titleNext: getStringOpt(opts, "title") }
      : {}),
    ...(typeof getStringOpt(opts, "when") === "string"
      ? { when: getStringOpt(opts, "when") }
      : {}),
    ...(typeof getStringOpt(opts, "description") === "string"
      ? { description: getStringOpt(opts, "description") }
      : {}),
    ...(typeof getStringOpt(opts, "session_id") === "string"
      ? { session_id: getStringOpt(opts, "session_id") }
      : {}),
    ...(typeof kind === "string" ? { kind } : {}),
    ...(typeof review === "boolean" ? { review } : {}),
    ...(getBooleanOpt(opts, "clearWhen") ? { clearWhen: true } : {}),
    ...(typeof resolvedStatus === "string" ? { status: resolvedStatus } : {}),
    ...(typeof getStringOpt(opts, "body") === "string"
      ? { body: getStringOpt(opts, "body") }
      : {}),
    ...(getBooleanOpt(opts, "clearBody") ? { clearBody: true } : {}),
  };
}

function mapTaskSetStatusCommandInput(params: {
  title: string;
  status: ShipTaskStatus;
}): TaskSetStatusRequest {
  return {
    title: String(params.title || "").trim(),
    status: params.status,
  };
}

function mapTaskDeleteCommandInput(titleInput: string): TaskDeleteRequest {
  const title = String(titleInput || "").trim();
  if (!title) throw new Error("Missing title");
  return { title };
}

export function mapTaskListCommandPayload(
  input: PluginActionCommandInput,
): TaskListActionPayload {
  return mapTaskListCommandInput(input.opts);
}

export function mapTaskCreateCommandPayload(
  input: PluginActionCommandInput,
): TaskCreateRequest {
  return mapTaskCreateCommandInput(input.opts);
}

export function mapTaskRunCommandPayload(
  input: PluginActionCommandInput,
): TaskRunRequest {
  const title = String(input.args[0] || "").trim();
  if (!title) throw new Error("Missing title");
  const reason = getStringOpt(input.opts, "reason");
  return {
    title,
    ...(reason ? { reason } : {}),
  };
}

export function mapTaskDeleteCommandPayload(
  input: PluginActionCommandInput,
): TaskDeleteRequest {
  return mapTaskDeleteCommandInput(String(input.args[0] || ""));
}

export function mapTaskUpdateCommandPayload(
  input: PluginActionCommandInput,
): TaskUpdateRequest {
  const title = String(input.args[0] || "").trim();
  if (!title) throw new Error("Missing title");
  return mapTaskUpdateCommandInput({
    title,
    opts: input.opts,
  });
}

export function mapTaskStatusCommandPayload(
  input: PluginActionCommandInput,
): TaskSetStatusRequest {
  const title = String(input.args[0] || "").trim();
  const status = readTaskStatusOrThrow(String(input.args[1] || "").trim());
  if (!title) throw new Error("Missing title");
  if (!status) throw new Error("Missing or invalid status");
  return mapTaskSetStatusCommandInput({ title, status });
}

export function mapTaskEnableCommandPayload(
  input: PluginActionCommandInput,
): TaskSetStatusRequest {
  const title = String(input.args[0] || "").trim();
  if (!title) throw new Error("Missing title");
  return mapTaskSetStatusCommandInput({
    title,
    status: "enabled",
  });
}

export function mapTaskDisableCommandPayload(
  input: PluginActionCommandInput,
): TaskSetStatusRequest {
  const title = String(input.args[0] || "").trim();
  if (!title) throw new Error("Missing title");
  return mapTaskSetStatusCommandInput({
    title,
    status: "disabled",
  });
}
