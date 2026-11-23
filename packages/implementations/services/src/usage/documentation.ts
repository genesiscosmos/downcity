/** Usage API 文档：Credits 与技术计量独立，日期以请求的 IANA 时区计算。 */
import type { ApiDocumentation } from "@downcity/downtown";
import { object_schema as obj, array_schema as arr, text_schema as text, number_schema as num, nullable_schema as nullable, enum_schema, time_schema } from "../shared/documentation.js";

const date = { type: "string", format: "date" };
const range_fields = { from: date, to: date, timezone: text("Required IANA timezone, e.g. Asia/Shanghai") };
const range = obj(range_fields);
const tokens = { uncached_input_tokens: num, cached_input_tokens: num, input_tokens: num, output_tokens: num, reasoning_tokens: num, total_tokens: num };
const ai_fields = { execution_count: num, metered_request_count: num, ...tokens, image_count: num, video_seconds: num, audio_seconds: num };
const bucket_fields = { credits: obj({ used: num, charge_count: num }), ai: obj(ai_fields) };
const user_fields = { user_id: text("User ID; summary may use an aggregate label"), last_active_at: time_schema, ...ai_fields, succeeded_count: num, failed_count: num, cancelled_count: num, success_rate: nullable(num), credits_used: num, charge_count: num, top_model_id: text("Most used model ID"), metering_unavailable_count: num, average_duration_ms: nullable(num), p95_duration_ms: nullable(num) };
const activity = { range_active_users: num, daily_active_users: num, weekly_active_users: num, monthly_active_users: num, daily_monthly_stickiness: nullable(num) };
const dimension = obj({ key: text("Model or action ID"), execution_count: num, succeeded_count: num, total_tokens: num, average_duration_ms: nullable(num) });
const rates = obj({ day_1: nullable(num), day_3: nullable(num), day_7: nullable(num), day_14: nullable(num), day_30: nullable(num) });
const errors = [{ status: 400, description: "Invalid ordered date range, range longer than 400 inclusive days, or invalid/missing IANA timezone" }, { status: 401, description: "User/admin authentication required as declared by the route" }, { status: 500, description: "A required reader query failed or could not produce a valid response" }];
const example = { from: "2026-11-01", to: "2026-11-19", timezone: "Asia/Shanghai" };

/** 五个 Usage 入口；查询不修改事实表或触发 AI 执行。 */
export const usage_documentation: Record<string, ApiDocumentation> = {
  "/me": {
    description: "Aggregate own applied Credits charges and AI technical usage independently over at most 400 inclusive local calendar days. days is sparse and ascending; data_available_from describes each source's reliable coverage start.",
    request_schema: range, response_schema: obj({ ...range_fields, credits_per_usd: num, data_available_from: obj({ credits: nullable(date), ai: nullable(date) }), summary: obj(bucket_fields), days: arr(obj({ date, ...bucket_fields })) }), errors,
    examples: [{ name: "Daily usage", request: example }],
  },
  "/me/recent": {
    description: "Read own recent individual AI usage by completed_at and usage_id descending. Reuse the returned opaque next_cursor; null means no more records. Token values are null when metering is unavailable.",
    request_schema: obj({ limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }, cursor: { type: "string", maxLength: 2048, description: "Opaque server-issued pagination cursor" } }, []),
    response_schema: obj({ items: arr(obj({ usage_id: text("Usage ID"), completed_at: time_schema, model_id: text("Downtown model ID"), action_id: text("AI action ID"), outcome: enum_schema("succeeded", "failed", "cancelled"), metering_status: enum_schema("settled", "unavailable"), ...Object.fromEntries(Object.keys(tokens).map(key => [key, nullable(num)])) })), next_cursor: nullable(text("Next-page cursor")) }),
    errors: [{ status: 400, description: "Invalid limit or cursor" }, ...errors.filter(error => error.status !== 400)], examples: [{ name: "First page", request: { limit: 20 }, response: { items: [], next_cursor: null } }],
  },
  "/admin/overview": {
    description: "Admin: cross-user usage, activity, model/action dimensions and performance. Rolling activity reads at least the final 30 local days. DAU/MAU and duration fields can be null without samples.", request_schema: range,
    response_schema: obj({ ...range_fields, activity: obj(activity), summary: obj(user_fields), days: arr(obj({ date, active_user_count: num, weekly_active_user_count: num, monthly_active_user_count: num, daily_monthly_stickiness: nullable(num), execution_count: num, total_tokens: num, credits_used: num, succeeded_count: num, failed_count: num, cancelled_count: num, uncached_input_tokens: num, cached_input_tokens: num, output_tokens: num, reasoning_tokens: num, metering_unavailable_count: num, average_duration_ms: nullable(num), p95_duration_ms: nullable(num), charge_count: num })), models: arr(dimension), actions: arr(dimension), hours: arr(obj({ hour: { type: "integer", minimum: 0, maximum: 23 }, active_user_count: num, execution_count: num })), performance: obj({ sample_count: num, average_duration_ms: nullable(num), p50_duration_ms: nullable(num), p95_duration_ms: nullable(num), max_duration_ms: nullable(num), metering_unavailable_count: num }) }), errors, examples: [{ name: "Overview", request: example }],
  },
  "/admin/users": {
    description: "Admin: users sorted by total tokens, Credits used, executions and user ID. Combines independently recorded AI and ledger facts.", request_schema: range, response_schema: obj({ ...range_fields, items: arr(obj(user_fields)) }), errors, examples: [{ name: "User usage", request: example }],
  },
  "/admin/retention": {
    description: "Admin: registered-user cohorts and AI activity retention on days 1, 3, 7, 14 and 30. Unobserved rates are null; averages are weighted by cohort size.", request_schema: range,
    response_schema: obj({ ...range_fields, total_registered_users: num, registration_days: arr(obj({ date, new_user_count: num })), cohorts: arr(obj({ date, new_user_count: num, rates })), average_rates: rates }), errors, examples: [{ name: "Retention", request: example }],
  },
};
