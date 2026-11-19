/**
 * AI Relay 的逐 action 公开文档。
 *
 * Schema 对照 keys/catalog 的校验器、Relay 公共类型及 runtime 的 SQL 投影维护。
 * 映射键与注册 ID 相同；运行时另行绑定仅检查本地初始化资源的 availability。
 * 示例只使用公开占位值；只有 keys/create 的真实响应含一次性明文凭据。
 */
import type { ApiDocumentation, ApiError, ApiSchema } from "../../types/ServiceDiscovery.js";

/** 生成有明确属性和必填字段的对象契约。 */
function object_schema(
  properties: Record<string, ApiSchema>,
  required: string[] = Object.keys(properties),
  additional_properties = false,
): ApiSchema {
  return { type: "object", properties, required, additionalProperties: additional_properties };
}

/** 描述列表元素，元素 schema 始终显式给出。 */
function array_schema(items: ApiSchema, max_items?: number): ApiSchema {
  return { type: "array", items, ...(max_items === undefined ? {} : { maxItems: max_items }) };
}

/** 描述数据库 LEFT JOIN 和未完成记录返回的空值。 */
function nullable_schema(schema: ApiSchema, description: string): ApiSchema {
  return { anyOf: [schema, { type: "null" }], description };
}

const text_schema: ApiSchema = { type: "string" };
const boolean_schema: ApiSchema = { type: "boolean" };
const time_schema: ApiSchema = { type: "string", format: "date-time", description: "ISO 8601 timestamp." };
const count_schema: ApiSchema = { type: "integer", minimum: 0 };
const id_schema: ApiSchema = {
  type: "string", minLength: 1, maxLength: 160, pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
  description: "Trimmed catalog ID; unique within its collection. Route IDs cannot equal public model IDs.",
};
const no_input_schema: ApiSchema = {
  type: "object", description: "No request fields are required or read by this handler; supplied fields are ignored.",
  additionalProperties: true,
};
const policy_properties: Record<string, ApiSchema> = {
  name: { type: "string", minLength: 1, maxLength: 100, description: "Human-readable name; trimmed before validation." },
  allowed_models: {
    ...array_schema({ type: "string", minLength: 1, maxLength: 160, description: "Trimmed public model or route ID, or *." }, 1000),
    default: [], description: "Allowed entry IDs. Empty denies all models; * allows all entries. IDs are not checked against the catalog here.",
  },
  spend_limit: {
    ...nullable_schema({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      "Soft limit in Credits, based only on completed settlements; null is unlimited. Concurrent/unsettled spending can exceed it."),
    default: null,
  },
  expires_at: {
    ...nullable_schema(time_schema, "ISO timestamp with timezone offset or null. Creation requires a future time; update does not enforce that rule."),
    default: null,
  },
};
const key_status_schema: ApiSchema = {
  type: "string", enum: ["active", "disabled", "revoked"],
  description: "active permits inference subject to policy; disabled can be restored; revoked is permanent.",
};
const key_schema = object_schema({
  ...policy_properties,
  key_id: { type: "string", description: "Independent credential record ID, not the secret token." },
  user_id: { type: "string", description: "Owning logged-in user ID." },
  prefix: { type: "string", description: "First 12 characters of the issued token for display; not usable as a credential." },
  status: key_status_schema,
  created_at: time_schema,
});
const key_id_schema: ApiSchema = { type: "string", description: "Key ID belonging to the current logged-in user." };
const update_policy_properties: Record<string, ApiSchema> = Object.fromEntries(
  Object.entries(policy_properties).map(([name, schema]) => {
    const { default: _default, ...without_default } = schema;
    return [name, without_default];
  }),
);
const key_example = {
  name: "Example key", allowed_models: ["example-model"], spend_limit: null, expires_at: null,
  key_id: "key_example", user_id: "user_example", prefix: "dck_example_", status: "active",
  created_at: "2030-01-01T00:00:00.000Z",
};
const user_errors: ApiError[] = [
  { status: 401, description: "A valid logged-in user session is required; a Relay API key is not a login credential." },
  { status: 403, description: "The authenticated identity is not permitted by this user-only action." },
  { status: 500, description: "Relay resources are not initialized or a storage/internal operation failed." },
];
const admin_errors: ApiError[] = [
  { status: 401, description: "Administrator authentication is missing or invalid." },
  { status: 403, description: "The authenticated identity is not an administrator; a user session or Relay API key is insufficient." },
  { status: 500, description: "Relay resources are not initialized or a storage/internal operation failed." },
];
const key_update_errors: ApiError[] = [
  ...user_errors,
  { status: 404, description: "The key ID is missing, unknown or belongs to another user." },
  { status: 409, description: "The key is already revoked, or its stored status changed concurrently; reload before updating." },
  { status: 422, description: "Policy fields or status are invalid, or unsupported policy properties are supplied." },
];
const user_requirements = [
  "A Federation user login is required; Relay dck_ credentials grant inference access only.",
  "AI Relay initialization must have completed with its prepared service database and key table.",
  "Discovery availability checks local bindings only; it does not query storage, test credentials or make model calls.",
];
const admin_requirements = [
  "A Federation administrator identity is required.",
  "AI Relay initialization must have completed with its prepared catalog, service database and registered model definitions.",
  "Discovery availability checks local bindings only; it does not query storage, inspect secret values or probe upstreams.",
];

const stream_policy_schema = object_schema({
  connect_timeout_ms: { type: "integer", minimum: 1, maximum: 2147483647, description: "Connection budget in milliseconds." },
  first_output_timeout_ms: { type: "integer", minimum: 1, maximum: 2147483647, description: "First effective output budget in milliseconds." },
  idle_timeout_ms: { type: "integer", minimum: 1, maximum: 2147483647, description: "Effective output idle budget in milliseconds." },
  total_timeout_ms: { type: "integer", minimum: 1, maximum: 2147483647, description: "Total stream budget in milliseconds." },
}, []);
const model_schema = object_schema({
  id: id_schema,
  template_model_id: { ...id_schema, description: "Must reference a registered model with runtime.stream; supplies capabilities and pricing." },
  enabled: boolean_schema,
});
const channel_schema: ApiSchema = {
  ...object_schema({
    id: id_schema,
    adapter: { type: "string", enum: ["registered", "openai_chat_completions"] },
    enabled: boolean_schema,
    base_url: {
      type: "string", format: "uri", maxLength: 2048,
      description: "Required for openai_chat_completions: HTTPS root with no username, password, query or fragment. Omit for registered.",
    },
    credential_env: {
      type: "string", pattern: "^[A-Z][A-Z0-9_]*$", maxLength: 160,
      description: "Required environment variable NAME for openai_chat_completions; never put its secret value here. Omit for registered.",
    },
    timeout_ms: {
      type: "integer", minimum: 1000, maximum: 300000,
      description: "Default connection/first-output/idle budget in milliseconds; runtime default is 120000.",
    },
    model_stream: {
      ...stream_policy_schema,
      description: "Optional per-phase stream budget overrides; total defaults to 900000 ms, bounded by the service deadline.",
    },
  }, ["id", "adapter", "enabled"]),
  allOf: [{
    if: { properties: { adapter: { const: "openai_chat_completions" } } },
    then: { required: ["base_url", "credential_env"] },
  }],
  description: "registered channel IDs must match an installed stream adapter channel. URLs and credential_env references are admin-only configuration.",
};
const deployment_schema = object_schema({
  id: id_schema,
  model_id: { ...id_schema, description: "Existing public model ID." },
  channel_id: { ...id_schema, description: "Existing channel ID." },
  upstream_model: { type: "string", minLength: 1, maxLength: 256, description: "Trimmed upstream model mapping." },
  runtime_model_id: {
    ...id_schema,
    description: "Required for registered: installed stream model matching template, channel and upstream_model. Omit for OpenAI channels.",
  },
  enabled: boolean_schema,
  priority: { type: "integer", minimum: -1000, maximum: 1000, description: "Higher priority tiers are selected first." },
  weight: { type: "integer", minimum: 1, maximum: 10000, description: "Positive sampling weight within the same priority tier." },
}, ["id", "model_id", "channel_id", "upstream_model", "enabled", "priority", "weight"]);
const route_schema = object_schema({
  id: id_schema,
  model_id: { ...id_schema, description: "Existing public model; determines capabilities and pricing for every attempt." },
  deployment_ids: {
    ...array_schema(id_schema, 100), minItems: 1, uniqueItems: true,
    description: "Existing deployments all belonging to the route's public model.",
  },
  strategy: { type: "string", const: "priority_weighted" },
  max_attempts: { type: "integer", minimum: 1, maximum: 3, description: "Maximum attempts including the initial attempt; does not guarantee a retry." },
  enabled: boolean_schema,
});
const catalog_schema: ApiSchema = {
  ...object_schema({
    models: array_schema(model_schema, 1000),
    channels: array_schema(channel_schema, 500),
    deployments: array_schema(deployment_schema, 5000),
    routes: array_schema(route_schema, 1000),
  }),
  description: "Full atomic catalog. IDs must be unique per collection; all references and registered adapter mappings are validated. Contains no credential values.",
};
const revision_schema: ApiSchema = {
  type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER,
  description: "Optimistic concurrency revision. Configure requires the last read revision and returns revision + 1.",
};
const catalog_snapshot_schema = object_schema({ catalog: catalog_schema, revision: revision_schema });
const catalog_example = {
  models: [{ id: "example-model", template_model_id: "example-template", enabled: true }],
  channels: [{
    id: "example-channel", adapter: "openai_chat_completions", enabled: true,
    base_url: "https://example.invalid/v1", credential_env: "EXAMPLE_UPSTREAM_API_KEY",
  }],
  deployments: [{
    id: "example-deployment", model_id: "example-model", channel_id: "example-channel",
    upstream_model: "example-upstream", enabled: true, priority: 0, weight: 1,
  }],
  routes: [{
    id: "example-route", model_id: "example-model", deployment_ids: ["example-deployment"],
    strategy: "priority_weighted", max_attempts: 2, enabled: true,
  }],
};
const metadata_schema = object_schema({
  adapters: array_schema({ type: "string", enum: ["registered", "openai_chat_completions"] }),
  templates: array_schema(object_schema({
    id: { type: "string", description: "Installed streaming model template/runtime ID." },
    name: { type: "string", description: "Registered display name." },
    channel_id: { type: "string", description: "Fixed registered runtime channel ID." },
    upstream_model: { type: "string", description: "Fixed registered upstream mapping." },
  })),
});
const health_schema = object_schema({
  checked_at: { type: "integer", description: "Server sample time in Unix milliseconds." },
  items: array_schema(object_schema({
    deployment_id: text_schema,
    channel_id: text_schema,
    enabled: { type: "boolean", description: "True only when deployment, its public model and channel are all enabled in the catalog." },
    cooldown_until: nullable_schema({ type: "integer" }, "Stored cooldown deadline in Unix milliseconds; null when there is no row. Expired deadlines may remain."),
    cooling: { type: "boolean", description: "Whether cooldown_until exceeds checked_at; no credential check or upstream probe is performed." },
  })),
});

const request_query_schema = object_schema({
  limit: {
    type: ["integer", "string"], minimum: 1, maximum: 100, default: 50,
    description: "Converted with Number(input.limit), then checked as an integer from 1 to 100. Numeric strings work for GET queries.",
  },
  before: {
    type: "string",
    description: "Exclusive request_id cursor. Compares (started_at, request_id) with that request's stored pair. Missing/empty ignores cursor; an unknown ID yields an empty page.",
  },
  key_id: { type: "string", description: "Optional exact Key ID filter, also applied when empty. Does not accept the secret API key." },
}, [], true);
const request_schema = object_schema({
  request_id: { type: "string", description: "Logical inference request ID; also the usage/settlement correlation ID." },
  user_id: { type: "string", description: "Owner user ID." },
  key_id: nullable_schema(text_schema, "Key record ID; null for logged-in inference calls. Never the token."),
  requested_model: { type: "string", description: "Public model or route ID supplied by the caller." },
  model_id: { type: "string", description: "Selected public model ID." },
  status: { type: "string", enum: ["running", "succeeded", "failed", "cancelled", "unknown"], description: "Logical request execution state, independent of settlement state." },
  started_at: time_schema,
  completed_at: nullable_schema(time_schema, "Completion timestamp; null while unfinished."),
  settlement_status: nullable_schema({ type: "string", enum: ["pending", "processing", "retryable", "completed", "rejected"] }, "Joined settlement job state, null if absent."),
  metering_status: nullable_schema({ type: "string", enum: ["settled", "unavailable"] }, "Technical metering state; null if no usage row. settled does not imply a completed charge."),
  uncached_input_tokens: nullable_schema(count_schema, "Uncached input token count, null if unknown or not yet recorded."),
  cached_input_tokens: nullable_schema(count_schema, "Cached input token count, null if unknown or not yet recorded."),
  output_tokens: nullable_schema(count_schema, "Output token count, null if unknown or not yet recorded."),
  reasoning_tokens: nullable_schema(count_schema, "Reasoning token count, null if unknown or not yet recorded."),
  duration_ms: nullable_schema(count_schema, "Usage execution duration in milliseconds, null if unknown."),
  channel_id: nullable_schema(text_schema, "Final metered channel ID, null if unknown."),
  upstream_model: nullable_schema(text_schema, "Final metered upstream model mapping, null if unknown."),
  charged_credits: nullable_schema({ type: "number" }, "Actual Credits extracted from the settlement payload only when status is completed; null otherwise or when charge is absent."),
});
const request_page_schema: ApiSchema = {
  ...object_schema({ items: array_schema(request_schema, 100) }),
  description: "Rows ordered by started_at DESC, request_id DESC. No total, has_more or next_cursor is returned. Use the last item's request_id as before for another page.",
};
const request_example = {
  request_id: "request_example", user_id: "user_example", key_id: "key_example",
  requested_model: "example-route", model_id: "example-model", status: "succeeded",
  started_at: "2030-01-01T00:00:00.000Z", completed_at: "2030-01-01T00:00:01.000Z",
  settlement_status: "completed", metering_status: "settled", uncached_input_tokens: 10,
  cached_input_tokens: 0, output_tokens: 5, reasoning_tokens: 0, duration_ms: 1000,
  channel_id: "example-channel", upstream_model: "example-upstream", charged_credits: 1,
};
const attempt_query_schema: ApiSchema = {
  ...object_schema({
    request_id: { type: "string", description: "Logical request ID. Missing or non-string input is treated as an empty ID and normally returns no rows, not a validation error." },
  }, [], true),
  description: "Supply request_id to read attempts. No limit or cursor is supported; other fields are ignored.",
};
const attempt_schema = object_schema({
  attempt_id: { type: "string", description: "Independent upstream attempt ID." },
  request_id: text_schema,
  deployment_id: text_schema,
  channel_id: text_schema,
  upstream_model: { type: "string", description: "Actual upstream model mapping for this attempt." },
  started_at: time_schema,
  completed_at: nullable_schema(time_schema, "Completion timestamp; null while unfinished."),
  http_status: nullable_schema({ type: "integer" }, "Observed upstream or abort HTTP status; null when unknown. This is a log field, not the HTTP status of this list action."),
  status: { type: "string", enum: ["running", "succeeded", "rejected", "failed", "cancelled", "unknown"] },
  first_output_ms: nullable_schema(count_schema, "Time from the logical request start to the first effective output event in milliseconds; null when not observed."),
});
const attempt_list_schema: ApiSchema = {
  ...object_schema({ items: array_schema(attempt_schema) }),
  description: "All attempts for the accessible request, ordered by started_at ASC, attempt_id ASC. No pagination, request body, response body, raw error or credential values.",
};
const attempt_example = {
  attempt_id: "attempt_example", request_id: "request_example", deployment_id: "example-deployment",
  channel_id: "example-channel", upstream_model: "example-upstream",
  started_at: "2030-01-01T00:00:00.000Z", completed_at: "2030-01-01T00:00:01.000Z",
  http_status: 200, status: "succeeded", first_output_ms: 100,
};
const log_requirements = [
  "Prepared Relay request/attempt tables and AI usage/settlement tables must be bound to the initialized service database.",
  "These endpoints read stored metadata only; they do not perform inference, retry requests or trigger settlement.",
];

/**
 * AI Relay documentation keyed by the exact registered action ID.
 * Runtime adds a per-instance availability callback without mutating this shared map.
 */
export const relay_documentation = {
  "keys/create": {
    description: "Create a Relay inference API key owned by the logged-in user. Returns the full api_key exactly once; persist it securely at issuance. Key management requires login and cannot be authorized with this key. Response key metadata excludes the digest.",
    request_schema: object_schema(policy_properties, ["name"]),
    response_schema: object_schema({
      key: key_schema,
      api_key: { type: "string", pattern: "^dck_[a-f0-9]{64}$", "x-sensitive": true, description: "Sensitive, one-time plaintext token. Real tokens have dck_ followed by 64 lowercase hex characters. Never log or embed it in documentation." },
    }),
    errors: [...user_errors, { status: 422, description: "Invalid/unknown policy fields, invalid timestamp, or expires_at is not in the future." }],
    examples: [{ name: "Issue a scoped key (token shown as a nonfunctional placeholder)", request: { name: "Example key", allowed_models: ["example-model"] }, response: { key: key_example, api_key: "<ONE_TIME_RELAY_API_KEY>" } }],
    requirements: user_requirements,
  },
  "keys/list": {
    description: "List every key owned by the logged-in user, including disabled/revoked keys. No pagination or ordering guarantee. Returns policy, display prefix and status; never plaintext api_key or digest.",
    request_schema: no_input_schema,
    response_schema: object_schema({ items: array_schema(key_schema) }),
    errors: user_errors,
    examples: [{ name: "List own keys", request: {}, response: { items: [key_example] } }],
    requirements: user_requirements,
  },
  "keys/update": {
    description: "Partially update an owned key's policy/status; omitted policy fields retain stored values. active and disabled can be switched; revoked cannot be changed or restored. Updates do not rotate or return the token. Unlike creation, expires_at may be a past timestamp. Concurrency checks the stored status, not a revision for all policy fields.",
    request_schema: object_schema({ key_id: key_id_schema, ...update_policy_properties, status: key_status_schema }, ["key_id"]),
    response_schema: key_schema,
    errors: key_update_errors,
    examples: [{ name: "Disable an owned key", request: { key_id: "key_example", status: "disabled" }, response: { ...key_example, status: "disabled" } }],
    requirements: user_requirements,
  },
  "keys/revoke": {
    description: "Permanently revoke an owned key by updating status to revoked. Only key_id is read; other supplied fields are ignored. Revocation blocks new inference authorization; it does not promise to cancel in-flight calls. Repeating revocation returns 409. No plaintext token or digest is returned.",
    request_schema: object_schema({ key_id: key_id_schema }, ["key_id"], true),
    response_schema: key_schema,
    errors: key_update_errors.filter((error) => error.status !== 422),
    examples: [{ name: "Permanently revoke", request: { key_id: "key_example" }, response: { ...key_example, status: "revoked" } }],
    requirements: user_requirements,
  },
  "relay/catalog": {
    description: "Administrator-only fresh read of the complete catalog and revision, bypassing the instance cache. The result is a cloned snapshot for editing. Includes upstream URLs, model mappings and credential environment variable NAMES, never credential values or key tokens.",
    request_schema: no_input_schema,
    response_schema: catalog_snapshot_schema,
    errors: [...admin_errors, { status: 422, description: "The stored catalog fails structural or installed model/reference validation." }],
    examples: [{ name: "Read editable catalog (replace example template with an installed template)", request: {}, response: { revision: 1, catalog: catalog_example } }],
    requirements: admin_requirements,
  },
  "relay/metadata": {
    description: "Administrator-only local projection of supported adapter IDs and installed streaming templates, including each template's fixed channel and upstream mapping. No provider configuration, environment values, runtime functions or inference call is exposed.",
    request_schema: no_input_schema,
    response_schema: metadata_schema,
    errors: admin_errors,
    examples: [{ name: "Read safe editor metadata", request: {}, response: { adapters: ["registered", "openai_chat_completions"], templates: [{ id: "example-template", name: "Example template", channel_id: "example-registered-channel", upstream_model: "example-upstream" }] } }],
    requirements: admin_requirements,
  },
  "relay/health": {
    description: "Administrator-only projection of current catalog deployments and stored shared cooldown deadlines. enabled combines deployment, model and channel switches; cooling compares the deadline with checked_at. Includes disabled deployments. Does not test credentials, network reachability or upstream health; catalog reads may use the five-second cache.",
    request_schema: no_input_schema,
    response_schema: health_schema,
    errors: [...admin_errors, { status: 422, description: "A catalog cache reload encounters invalid stored catalog data." }],
    examples: [{ name: "Read stored cooldown state", request: {}, response: { checked_at: 1893456000000, items: [{ deployment_id: "example-deployment", channel_id: "example-channel", enabled: true, cooldown_until: null, cooling: false }] } }],
    requirements: [...admin_requirements, "The prepared shared Relay health table is required; this action performs no upstream probe."],
  },
  "relay/configure": {
    description: "Administrator-only atomic replacement of the entire catalog using the last read revision. No merge is performed. Validates bounds, duplicate IDs, references, stream templates and registered adapter mappings. OpenAI channels require credential-free HTTPS roots and environment variable names. Stored secret values are never accepted as credential fields. On success this instance invalidates its cache; other instances refresh after up to five seconds. Configuration validation does not prove credentials or upstream availability.",
    request_schema: object_schema({ catalog: catalog_schema, revision: revision_schema }, ["catalog", "revision"], true),
    response_schema: object_schema({ revision: { type: "integer", minimum: 2, description: "Persisted previous revision + 1." } }),
    errors: [...admin_errors,
      { status: 409, description: "Revision does not match the stored catalog (or the catalog row is absent); read the current catalog before saving again." },
      { status: 422, description: "Missing/unsafe/non-positive revision, invalid catalog fields, duplicate IDs, invalid references, unsupported template, invalid channel URL/credential reference or mismatched registered deployment." }],
    examples: [{ name: "Replace the full catalog (all IDs and endpoint are placeholders)", request: { catalog: catalog_example, revision: 1 }, response: { revision: 2 } }],
    requirements: admin_requirements,
  },
  "relay/requests": {
    description: "List the logged-in user's Relay requests with left-joined usage and settlement facts. Ownership is always enforced; key_id only narrows the result. Does not include prompts, completions, secret tokens or key digests. Pagination uses before=request_id and descending (started_at, request_id); no next_cursor is returned. Missing join data remains null; charged_credits is populated only for completed settlement with a charge.",
    request_schema: request_query_schema,
    response_schema: request_page_schema,
    errors: [...user_errors, { status: 422, description: "limit cannot be converted to an integer from 1 to 100." }],
    examples: [{ name: "Read own request page", request: { limit: 50, key_id: "key_example", before: "request_cursor_example" }, response: { items: [request_example] } }],
    requirements: [...user_requirements, ...log_requirements],
  },
  "relay/admin/requests": {
    description: "Administrator-only cross-user version of relay/requests. No user ownership predicate is applied. Supports only limit, before and key_id; there is no user_id filter. Includes owner IDs and safe upstream/settlement metadata, never secret tokens, digests or message bodies. Same descending cursor ordering, nullable joins and completed-only charged_credits as the user endpoint.",
    request_schema: request_query_schema,
    response_schema: request_page_schema,
    errors: [...admin_errors, { status: 422, description: "limit cannot be converted to an integer from 1 to 100." }],
    examples: [{ name: "Read a cross-user page", request: { limit: 50, before: "request_cursor_example" }, response: { items: [request_example] } }],
    requirements: [...admin_requirements, ...log_requirements],
  },
  "relay/attempts": {
    description: "List all upstream attempts joined to a request owned by the logged-in user. Unknown, missing, or another user's request_id returns items: [], not 404. Ordered by started_at then attempt_id ascending, without pagination. Exposes routing/status/timing metadata; no request/response bodies, raw upstream errors, tokens or digests.",
    request_schema: attempt_query_schema,
    response_schema: attempt_list_schema,
    errors: user_errors,
    examples: [{ name: "Read own request's attempts", request: { request_id: "request_example" }, response: { items: [attempt_example] } }, { name: "Unknown or inaccessible request", request: { request_id: "request_unknown_example" }, response: { items: [] } }],
    requirements: [...user_requirements, ...log_requirements],
  },
  "relay/admin/attempts": {
    description: "Administrator-only cross-user attempt lookup by request_id. No ownership predicate; attempts must still join an existing request row. Missing or unknown request_id returns items: []. All matching attempts are returned in ascending (started_at, attempt_id) order without pagination, payload bodies, raw errors or credential material.",
    request_schema: attempt_query_schema,
    response_schema: attempt_list_schema,
    errors: admin_errors,
    examples: [{ name: "Inspect any user's request attempts", request: { request_id: "request_example" }, response: { items: [attempt_example] } }],
    requirements: [...admin_requirements, ...log_requirements],
  },
} satisfies Record<string, ApiDocumentation>;

/** 可由 AIService instruction 整合的 Relay 专属公开说明，不含配置实际值。 */
export const relay_public_instruction = `AI Relay separates inference keys from Federation login: dck_ keys authorize supported language-model inference only and never grant user or administrator identity. Users manage only their own keys through keys/create, keys/list, keys/update and keys/revoke; creation alone returns a sensitive one-time api_key. Store that token securely and never publish it. allowed_models accepts public model/route IDs or *; an empty list denies all model access. spend_limit is a soft Credits cap based on completed settlements. Revoked keys cannot be restored and revocation blocks new authorization, without cancelling in-flight calls.
Administrators use relay/metadata to inspect installed stream templates and adapters, relay/catalog to read a fresh full catalog plus revision, and relay/configure to atomically replace it with optimistic concurrency. Configure model/channel/deployment/route references together; credential_env contains an environment variable name, never a secret value. A valid catalog does not establish upstream readiness. relay/health reports configuration enablement and stored cooldowns only, without live probes.
Users read their own relay/requests and relay/attempts; administrators use relay/admin/requests and relay/admin/attempts across users. Requests accept limit (1–100, default 50), before (exclusive request_id cursor) and optional key_id; take the last returned request_id as the next before. Responses contain items only, without totals or next_cursor. Attempts accept request_id and return all accessible attempts; unknown/inaccessible IDs yield an empty list. Usage and settlement joins can be null, and charged_credits is actual completed settlement charge only. Discovery availability describes local initialization bindings, not permissions, balance, database reachability or upstream health.`;
