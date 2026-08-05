/**
 * AI Usage 与可靠结算 Repository。
 *
 * Settlement Job 是持久化恢复边界。处理过程采用 at-least-once 语义，Usage
 * Record 与 Credits Charge 分别通过 usage_id 和 ai:usage_id 保证幂等。
 */

import type { CityTableApi } from "../../store/table-api.js";
import type { ServiceDatabaseContext } from "../../types/database/Database.js";
import type { AICreditsBridge } from "../../types/AI.js";
import type {
  AdminAIDailyUsageBucket,
  AdminAIHourlyUsageBucket,
  AdminAIUsageResult,
  AdminAIUsageDimensionBucket,
  AdminAIUsageUserBucket,
  AdminUsageQuery,
  AIDailyUsageBucket,
  AIDailyUsageResult,
  AIRecentUsageItem,
  AIRecentUsageResult,
  AIRecentUsageRow,
  AISettlementPayload,
  AISettlementStatus,
  AIUsageRecord,
  UserDailyUsageQuery,
  UserRecentAIUsageQuery,
} from "../../types/AIUsage.js";
import {
  create_usage_date_formatter,
  create_usage_utc_envelope,
  format_usage_local_date,
  read_usage_integer,
} from "../../utils/UsageDate.js";

const LEASE_DURATION_MS = 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

/** AI 结算任务数据库行。 */
interface AISettlementJobRow extends Record<string, unknown> {
  /** 结算任务与 AI 执行共享的稳定 ID。 */
  usage_id: string;
  /** 当前结算状态。 */
  status: AISettlementStatus;
  /** 安全结算负载 JSON。 */
  payload_json: string;
  /** 已执行次数。 */
  attempt_count: number;
  /** 下一次允许领取的时间。 */
  next_attempt_at: string;
  /** 当前租约令牌。 */
  lease_token: string;
  /** 当前租约到期时间。 */
  lease_expires_at: string;
  /** 最近一次稳定错误码。 */
  last_error_code: string;
  /** 最近一次不含敏感信息的错误消息。 */
  last_error_message: string;
  /** 创建时间。 */
  created_at: string;
  /** 更新时间。 */
  updated_at: string;
  /** 完成时间；未完成时为空字符串。 */
  completed_at: string;
}

/** 单次结算处理结果。 */
export interface AISettlementProcessResult {
  /** 处理后的稳定任务状态。 */
  status: AISettlementStatus;
  /** Retryable 任务下一次允许执行的时间。 */
  next_attempt_at?: string;
}

/** AIService 私有 Usage Repository。 */
export class AIUsageRepository {
  constructor(
    private readonly database: ServiceDatabaseContext,
    private readonly usage_records: CityTableApi<AIUsageRecord>,
    private readonly settlement_jobs: CityTableApi<AISettlementJobRow>,
    private readonly credits?: AICreditsBridge,
  ) {}

  /** 幂等创建一条可靠结算任务。 */
  async create_settlement(payload: AISettlementPayload): Promise<void> {
    const now = new Date().toISOString();
    await this.settlement_jobs.insert_if_absent({
      usage_id: payload.record.usage_id,
      status: "pending",
      payload_json: JSON.stringify(payload),
      attempt_count: 0,
      next_attempt_at: now,
      lease_token: "",
      lease_expires_at: "",
      last_error_code: "",
      last_error_message: "",
      created_at: now,
      updated_at: now,
      completed_at: "",
    });
  }

  /** 领取并处理指定结算任务。重复调用保持幂等。 */
  async process_settlement(usage_id: string): Promise<AISettlementProcessResult> {
    const job = (await this.settlement_jobs.select({ usage_id }))[0];
    if (!job) throw new Error(`AI settlement job not found: ${usage_id}`);
    if (job.status === "completed" || job.status === "rejected") return { status: job.status };

    const now = new Date();
    if (job.status === "retryable" && Date.parse(job.next_attempt_at) > now.getTime()) {
      return { status: "retryable", next_attempt_at: job.next_attempt_at };
    }
    if (job.status === "processing" && Date.parse(job.lease_expires_at) > now.getTime()) {
      return { status: "processing" };
    }

    const lease_token = crypto.randomUUID();
    const claimed = await this.claim_job(job, lease_token, now);
    if (!claimed) return { status: "processing" };

    try {
      const payload = parse_settlement_payload(job.payload_json);
      await this.usage_records.insert_if_absent(payload.record);
      await this.apply_charge(payload);
      const completed_at = new Date().toISOString();
      await this.settlement_jobs.update({
        where: { usage_id, status: "processing", lease_token },
        values: {
          status: "completed",
          updated_at: completed_at,
          completed_at,
          lease_token: "",
          lease_expires_at: "",
          last_error_code: "",
          last_error_message: "",
        },
      });
      return { status: "completed" };
    } catch (error) {
      const rejected = read_http_status(error) === 402;
      const status: AISettlementStatus = rejected ? "rejected" : "retryable";
      const attempt_count = read_usage_integer(job.attempt_count) + 1;
      const next_attempt_at = new Date(
        Date.now() + Math.min(1000 * 2 ** Math.min(attempt_count, 12), MAX_RETRY_DELAY_MS),
      ).toISOString();
      const updated_at = new Date().toISOString();
      await this.settlement_jobs.update({
        where: { usage_id, status: "processing", lease_token },
        values: {
          status,
          attempt_count,
          next_attempt_at,
          updated_at,
          completed_at: rejected ? updated_at : "",
          lease_token: "",
          lease_expires_at: "",
          last_error_code: rejected ? "insufficient_credits" : "settlement_failed",
          last_error_message: safe_error_message(error),
        },
      });
      console.error("[AIService] settlement failed", {
        usage_id,
        status,
        error_code: rejected ? "insufficient_credits" : "settlement_failed",
        error: safe_error_message(error),
      });
      return { status, ...(status === "retryable" ? { next_attempt_at } : {}) };
    }
  }

  /** 读取当前到期、可恢复的结算任务 ID。 */
  async list_due_settlements(limit = 20): Promise<string[]> {
    const result = await this.database.query<{ usage_id: string }>({
      sql: [
        "SELECT usage_id FROM service_ai_settlement_jobs",
        "WHERE (status IN ('pending', 'retryable') AND next_attempt_at <= ?)",
        "OR (status = 'processing' AND lease_expires_at <= ?)",
        "ORDER BY next_attempt_at ASC LIMIT ?",
      ].join(" "),
      params: [new Date().toISOString(), new Date().toISOString(), limit],
    });
    return result.rows.map((row) => String(row.usage_id));
  }

  /** 按用户、当地日期范围与 IANA 时区聚合技术用量。 */
  async aggregate_user_daily_usage(input: UserDailyUsageQuery): Promise<AIDailyUsageResult> {
    const envelope = create_usage_utc_envelope(input.from, input.to);
    const rows = (await this.database.query<AIUsageRecord>({
      sql: [
        "SELECT * FROM service_ai_usage_records",
        "WHERE user_id = ? AND completed_at >= ? AND completed_at < ?",
        "ORDER BY completed_at ASC",
      ].join(" "),
      params: [input.user_id, envelope.from_utc, envelope.to_utc_exclusive],
    })).rows;
    const first = (await this.database.query<{ completed_at: string }>({
      sql: "SELECT completed_at FROM service_ai_usage_records WHERE user_id = ? ORDER BY completed_at ASC LIMIT 1",
      params: [input.user_id],
    })).rows[0];
    const formatter = create_usage_date_formatter(input.timezone);
    const by_date = new Map<string, AIDailyUsageBucket>();
    for (const row of rows) {
      const date = format_usage_local_date(formatter, row.completed_at);
      if (date < input.from || date > input.to) continue;
      const bucket = by_date.get(date) ?? empty_ai_bucket(date);
      bucket.execution_count += 1;
      if (row.metering_status === "settled") add_metering(bucket, row);
      by_date.set(date, bucket);
    }
    return {
      data_available_from: first
        ? format_usage_local_date(formatter, first.completed_at)
        : null,
      days: [...by_date.values()].sort((left, right) => left.date.localeCompare(right.date)),
    };
  }

  /** 按日期范围聚合 Federation 全部用户的 AI 技术用量。 */
  async aggregate_admin_usage(input: AdminUsageQuery): Promise<AdminAIUsageResult> {
    const envelope = create_usage_utc_envelope(input.from, input.to);
    const rows = (await this.database.query<AIUsageRecord>({
      sql: [
        "SELECT * FROM service_ai_usage_records",
        "WHERE user_id IS NOT NULL AND completed_at >= ? AND completed_at < ?",
        "ORDER BY completed_at ASC",
      ].join(" "),
      params: [envelope.from_utc, envelope.to_utc_exclusive],
    })).rows;
    const formatter = create_usage_date_formatter(input.timezone);
    const users = new Map<string, AdminAIUsageUserBucket>();
    const model_counts = new Map<string, Map<string, number>>();
    const user_durations = new Map<string, number[]>();
    const days = new Map<string, { bucket: AdminAIDailyUsageBucket; users: Set<string>; durations: number[] }>();
    const models = new Map<string, UsageDimensionState>();
    const actions = new Map<string, UsageDimensionState>();
    const hours = new Map<number, { execution_count: number; users: Set<string> }>();
    const durations: number[] = [];
    let metering_unavailable_count = 0;
    const hour_formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: input.timezone,
      hour: "2-digit",
      hourCycle: "h23",
    });

    for (const row of rows) {
      const user_id = String(row.user_id ?? "").trim();
      if (!user_id) continue;
      const date = format_usage_local_date(formatter, row.completed_at);
      if (date < input.from || date > input.to) continue;

      const user = users.get(user_id) ?? empty_admin_user_bucket(user_id);
      user.execution_count += 1;
      if (row.outcome === "succeeded") user.succeeded_count += 1;
      else if (row.outcome === "failed") user.failed_count += 1;
      else user.cancelled_count += 1;
      user.last_active_at = row.completed_at > user.last_active_at ? row.completed_at : user.last_active_at;
      if (!user.active_dates.includes(date)) user.active_dates.push(date);
      if (row.metering_status === "settled") add_admin_user_metering(user, row);
      else user.metering_unavailable_count += 1;
      users.set(user_id, user);

      const duration_ms = read_optional_duration(row.duration_ms);
      if (duration_ms !== null) {
        durations.push(duration_ms);
        const values = user_durations.get(user_id) ?? [];
        values.push(duration_ms);
        user_durations.set(user_id, values);
      }
      if (row.metering_status === "unavailable") metering_unavailable_count += 1;

      add_dimension(models, String(row.model_id ?? "").trim(), row, duration_ms);
      add_dimension(actions, String(row.action_id ?? "").trim(), row, duration_ms);

      const hour = Number(hour_formatter.format(new Date(row.completed_at)));
      const hour_state = hours.get(hour) ?? { execution_count: 0, users: new Set<string>() };
      hour_state.execution_count += 1;
      hour_state.users.add(user_id);
      hours.set(hour, hour_state);

      const user_model_counts = model_counts.get(user_id) ?? new Map<string, number>();
      const model_id = String(row.model_id ?? "").trim();
      if (model_id) user_model_counts.set(model_id, (user_model_counts.get(model_id) ?? 0) + 1);
      model_counts.set(user_id, user_model_counts);

      const day_state = days.get(date) ?? {
        bucket: {
          ...empty_ai_bucket(date),
          active_user_count: 0,
          succeeded_count: 0,
          failed_count: 0,
          cancelled_count: 0,
          metering_unavailable_count: 0,
          average_duration_ms: null,
          p95_duration_ms: null,
        },
        users: new Set<string>(),
        durations: [],
      };
      day_state.bucket.execution_count += 1;
      if (row.outcome === "succeeded") day_state.bucket.succeeded_count += 1;
      else if (row.outcome === "failed") day_state.bucket.failed_count += 1;
      else day_state.bucket.cancelled_count += 1;
      if (row.metering_status === "unavailable") day_state.bucket.metering_unavailable_count += 1;
      if (row.metering_status === "settled") add_metering(day_state.bucket, row);
      if (duration_ms !== null) day_state.durations.push(duration_ms);
      day_state.users.add(user_id);
      days.set(date, day_state);
    }

    const user_items = [...users.values()].map((user) => ({
      ...user,
      active_dates: user.active_dates.sort(),
      top_model_id: read_top_model(model_counts.get(user.user_id)),
      average_duration_ms: average(user_durations.get(user.user_id) ?? []),
      p95_duration_ms: percentile(user_durations.get(user.user_id) ?? [], 0.95),
    })).sort((left, right) => right.execution_count - left.execution_count || left.user_id.localeCompare(right.user_id));
    return {
      users: user_items,
      days: [...days.values()].map((state) => ({
        ...state.bucket,
        active_user_count: state.users.size,
        average_duration_ms: average(state.durations),
        p95_duration_ms: percentile(state.durations, 0.95),
      })).sort((left, right) => left.date.localeCompare(right.date)),
      models: dimension_items(models),
      actions: dimension_items(actions),
      hours: Array.from({ length: 24 }, (_, hour): AdminAIHourlyUsageBucket => ({
        hour,
        active_user_count: hours.get(hour)?.users.size ?? 0,
        execution_count: hours.get(hour)?.execution_count ?? 0,
      })),
      performance: {
        sample_count: durations.length,
        average_duration_ms: average(durations),
        p50_duration_ms: percentile(durations, 0.5),
        p95_duration_ms: percentile(durations, 0.95),
        max_duration_ms: durations.length > 0 ? Math.max(...durations) : null,
        metering_unavailable_count,
      },
    };
  }

  /** 按稳定游标读取当前用户最近的单次 AI Token 用量。 */
  async list_user_recent_usage(input: UserRecentAIUsageQuery): Promise<AIRecentUsageResult> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new TypeError("Recent AI usage limit must be between 1 and 50");
    }
    const cursor = input.cursor;
    const result = await this.database.query<AIRecentUsageRow>({
      sql: cursor
        ? [
          "SELECT usage_id, completed_at, model_id, action_id, outcome, metering_status,",
          "uncached_input_tokens, cached_input_tokens, output_tokens, reasoning_tokens",
          "FROM service_ai_usage_records",
          "WHERE user_id = ? AND (completed_at < ? OR (completed_at = ? AND usage_id < ?))",
          "ORDER BY completed_at DESC, usage_id DESC LIMIT ?",
        ].join(" ")
        : [
          "SELECT usage_id, completed_at, model_id, action_id, outcome, metering_status,",
          "uncached_input_tokens, cached_input_tokens, output_tokens, reasoning_tokens",
          "FROM service_ai_usage_records",
          "WHERE user_id = ?",
          "ORDER BY completed_at DESC, usage_id DESC LIMIT ?",
        ].join(" "),
      params: cursor
        ? [input.user_id, cursor.completed_at, cursor.completed_at, cursor.usage_id, input.limit + 1]
        : [input.user_id, input.limit + 1],
    });
    return {
      items: result.rows.slice(0, input.limit).map(to_recent_usage_item),
      has_more: result.rows.length > input.limit,
    };
  }

  /** 使用 compare-and-set 领取任务租约。 */
  private async claim_job(
    job: AISettlementJobRow,
    lease_token: string,
    now: Date,
  ): Promise<boolean> {
    const changed = await this.settlement_jobs.update({
      where: {
        usage_id: job.usage_id,
        status: job.status,
        lease_token: job.lease_token,
      },
      values: {
        status: "processing",
        lease_token,
        lease_expires_at: new Date(now.getTime() + LEASE_DURATION_MS).toISOString(),
        updated_at: now.toISOString(),
      },
    });
    return changed === 1;
  }

  /** 执行已固化的账单草稿。 */
  private async apply_charge(payload: AISettlementPayload): Promise<void> {
    const charge = payload.charge;
    const user_id = charge?.user_id ?? payload.record.user_id ?? undefined;
    if (!charge || charge.credits <= 0 || !user_id || !this.credits) return;
    await this.credits.charge({
      ...charge,
      user_id,
      ref: payload.record.usage_id,
      idempotency_key: `ai:${payload.record.usage_id}`,
      source: "model_usage",
    });
  }
}

/** 将 AI Usage 数据行转换为不泄漏内部字段的用户投影。 */
function to_recent_usage_item(row: AIRecentUsageRow): AIRecentUsageItem {
  if (row.metering_status === "unavailable") {
    return {
      usage_id: row.usage_id,
      completed_at: row.completed_at,
      model_id: row.model_id,
      action_id: row.action_id,
      outcome: row.outcome,
      metering_status: row.metering_status,
      uncached_input_tokens: null,
      cached_input_tokens: null,
      input_tokens: null,
      output_tokens: null,
      reasoning_tokens: null,
      total_tokens: null,
    };
  }
  const uncached_input_tokens = read_usage_integer(row.uncached_input_tokens);
  const cached_input_tokens = read_usage_integer(row.cached_input_tokens);
  const input_tokens = uncached_input_tokens + cached_input_tokens;
  const output_tokens = read_usage_integer(row.output_tokens);
  return {
    usage_id: row.usage_id,
    completed_at: row.completed_at,
    model_id: row.model_id,
    action_id: row.action_id,
    outcome: row.outcome,
    metering_status: row.metering_status,
    uncached_input_tokens,
    cached_input_tokens,
    input_tokens,
    output_tokens,
    reasoning_tokens: Math.min(read_usage_integer(row.reasoning_tokens), output_tokens),
    total_tokens: input_tokens + output_tokens,
  };
}

/** 创建零值 AI Bucket。 */
function empty_ai_bucket(date: string): AIDailyUsageBucket {
  return {
    date,
    execution_count: 0,
    metered_request_count: 0,
    uncached_input_tokens: 0,
    cached_input_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    image_count: 0,
    video_seconds: 0,
    audio_seconds: 0,
  };
}

/** 创建 Admin 用户 AI 用量零值。 */
function empty_admin_user_bucket(user_id: string): AdminAIUsageUserBucket {
  return {
    user_id,
    execution_count: 0,
    succeeded_count: 0,
    failed_count: 0,
    cancelled_count: 0,
    metered_request_count: 0,
    uncached_input_tokens: 0,
    cached_input_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    image_count: 0,
    video_seconds: 0,
    audio_seconds: 0,
    last_active_at: "",
    active_dates: [],
    top_model_id: "",
    metering_unavailable_count: 0,
    average_duration_ms: null,
    p95_duration_ms: null,
  };
}

/** 模型或 Action 维度的内部可变聚合状态。 */
interface UsageDimensionState {
  /** 执行次数。 */
  execution_count: number;
  /** 成功次数。 */
  succeeded_count: number;
  /** 已结算 Token 总量。 */
  total_tokens: number;
  /** 有效耗时样本。 */
  durations: number[];
}

/** 累加模型或 Action 维度。 */
function add_dimension(
  dimensions: Map<string, UsageDimensionState>,
  key: string,
  row: AIUsageRecord,
  duration_ms: number | null,
): void {
  if (!key) return;
  const state = dimensions.get(key) ?? {
    execution_count: 0,
    succeeded_count: 0,
    total_tokens: 0,
    durations: [],
  };
  state.execution_count += 1;
  if (row.outcome === "succeeded") state.succeeded_count += 1;
  if (row.metering_status === "settled") {
    state.total_tokens += read_usage_integer(row.uncached_input_tokens)
      + read_usage_integer(row.cached_input_tokens)
      + read_usage_integer(row.output_tokens);
  }
  if (duration_ms !== null) state.durations.push(duration_ms);
  dimensions.set(key, state);
}

/** 生成稳定排序的公开维度列表。 */
function dimension_items(dimensions: Map<string, UsageDimensionState>): AdminAIUsageDimensionBucket[] {
  return [...dimensions.entries()].map(([key, state]) => ({
    key,
    execution_count: state.execution_count,
    succeeded_count: state.succeeded_count,
    total_tokens: state.total_tokens,
    average_duration_ms: average(state.durations),
  })).sort((left, right) => right.execution_count - left.execution_count || left.key.localeCompare(right.key));
}

/** 读取合法的执行耗时。 */
function read_optional_duration(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

/** 计算耗时平均值。 */
function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** 使用 nearest-rank 计算百分位。 */
function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? null;
}

/** 累加用户维度的 settled AI Metering。 */
function add_admin_user_metering(bucket: AdminAIUsageUserBucket, row: AIUsageRecord): void {
  const uncached = read_usage_integer(row.uncached_input_tokens);
  const cached = read_usage_integer(row.cached_input_tokens);
  const output = read_usage_integer(row.output_tokens);
  bucket.metered_request_count += read_usage_integer(row.request_count);
  bucket.uncached_input_tokens += uncached;
  bucket.cached_input_tokens += cached;
  bucket.input_tokens += uncached + cached;
  bucket.output_tokens += output;
  bucket.reasoning_tokens += Math.min(read_usage_integer(row.reasoning_tokens), output);
  bucket.total_tokens += uncached + cached + output;
  bucket.image_count += read_usage_integer(row.image_count);
  bucket.video_seconds += read_usage_integer(row.video_seconds);
  bucket.audio_seconds += read_usage_integer(row.audio_seconds);
}

/** 读取调用次数最多的模型；次数相同时按模型 ID 稳定排序。 */
function read_top_model(counts: Map<string, number> | undefined): string {
  if (!counts) return "";
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "";
}

/** 把一条 settled metering 累加到每日 Bucket。 */
function add_metering(bucket: AIDailyUsageBucket, row: AIUsageRecord): void {
  const uncached = read_usage_integer(row.uncached_input_tokens);
  const cached = read_usage_integer(row.cached_input_tokens);
  const output = read_usage_integer(row.output_tokens);
  bucket.metered_request_count += read_usage_integer(row.request_count);
  bucket.uncached_input_tokens += uncached;
  bucket.cached_input_tokens += cached;
  bucket.input_tokens += uncached + cached;
  bucket.output_tokens += output;
  bucket.reasoning_tokens += Math.min(read_usage_integer(row.reasoning_tokens), output);
  bucket.total_tokens += uncached + cached + output;
  bucket.image_count += read_usage_integer(row.image_count);
  bucket.video_seconds += read_usage_integer(row.video_seconds);
  bucket.audio_seconds += read_usage_integer(row.audio_seconds);
}

/** 解析并校验结算任务负载的最小结构。 */
function parse_settlement_payload(value: string): AISettlementPayload {
  const parsed = JSON.parse(value) as Partial<AISettlementPayload>;
  if (!parsed.record?.usage_id) throw new Error("AI settlement payload is invalid");
  return {
    record: parsed.record,
    charge: parsed.charge ?? null,
  };
}

/** 读取 Downcity HTTP 错误状态。 */
function read_http_status(error: unknown): number | undefined {
  return error && typeof error === "object"
    ? Number((error as { statusCode?: unknown }).statusCode)
    : undefined;
}

/** 生成不会包含数据库细节或请求内容的结算错误消息。 */
function safe_error_message(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}
