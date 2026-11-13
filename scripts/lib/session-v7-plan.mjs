/**
 * Loss-aware v5/v6 -> v7 conversion planning, with no database or attachment writes.
 *
 * Visibility is evaluated before actor kind. Unknown/incomplete actors, contradictory
 * unaccounted background inputs, unsupported Inbox content and ambiguous interactions
 * block the entire database. Original JSON is retained for unchanged Parts; transformed
 * Parts have explicit identity/nesting mappings and content hashes, never body text.
 */
import { digest, fail, canonical_tables, derived_tables, validate_source_structure, group_parts_by_message } from "./session-v7-database.mjs";

import { repair_snapshot } from "./session-v7-repairs.mjs";

const background_tags = new Set(["background_source", "delegation_result", "delegation_interaction", "shell_result", "task_result"]);

/** Read a JSON object without exposing raw parser diagnostics. */
function json_object(value) {
  let parsed;
  try { parsed = JSON.parse(value); } catch { fail("invalid_json_object"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("invalid_json_object");
  return parsed;
}

/** Validate all request accounting, retaining the original object without normalizing actor IDs. */
function read_meta(row, runtime) {
  if (row.meta === null) return undefined;
  const meta = json_object(row.meta);
  if (Object.keys(meta).some(key => !["from", "powers", "callback"].includes(key))) fail("unknown_request_accounting_field");
  if (!runtime.session_prompt_actor_schema.safeParse(meta.from).success) fail("invalid_or_incomplete_actor");
  return meta;
}

/** Extract only the known structural causal field; keep its context item in Inbox content too. */
function causal_source(parts) {
  const turns = new Set();
  for (const part of parts) {
    if (part.type !== "context") continue;
    const content = json_object(part.content);
    if (content.tag !== "background_source") continue;
    const source = json_object(content.context);
    if (Object.keys(source).some(key => key !== "caller_turn_id") || typeof source.caller_turn_id !== "string" || !source.caller_turn_id) fail("invalid_background_source");
    turns.add(source.caller_turn_id);
  }
  if (turns.size > 1) fail("conflicting_background_source_turns");
  return turns.size ? { turn_id: [...turns][0] } : undefined;
}

/** Strictly remove only Part identity, not business fields, from supported Inbox items. */
function inbox_content(parts) {
  return parts.map(part => {
    if (!["text", "context", "file"].includes(part.type) || part.step_id !== null) fail("unsupported_inbox_content");
    return { ...json_object(part.content), type: part.type };
  });
}

/** Detect explicit historical runtime structures, never classify plain prose by keywords. */
function has_background_structure(parts) {
  return parts.some(part => {
    const content = json_object(part.content);
    return (part.type === "context" && background_tags.has(content.tag))
      || (part.type === "text" && /^\s*<(runtime_input|background_source|delegation_result|shell_result|task_result)(\s|>)/u.test(content.text));
  });
}

/** Canonical kind follows supported context markers, then runtime namespace, then legacy_input. */
function input_kind(parts, meta) {
  for (const part of parts) {
    if (part.type !== "context") continue;
    const tag = json_object(part.content).tag;
    if (background_tags.has(tag) && tag !== "background_source") return tag;
  }
  return meta?.from.kind === "runtime" ? meta.from.namespace : meta?.from.kind === "session" ? "session_input" : "legacy_input";
}

/** Fold a legacy Interaction only into its unique same-Message Tool, with strict payload keys. */
function fold_interactions(parts, mapping) {
  const interactions = parts.filter(part => part.type === "interaction");
  if (!interactions.length) return parts;
  const result = parts.filter(part => part.type !== "interaction").map(part => ({ ...part }));
  for (const row of interactions) {
    const interaction = json_object(row.content);
    if (Object.keys(interaction).some(key => !["interaction_id", "interaction_type", "status", "request", "response", "resolved_at", "cancel_reason"].includes(key))) fail("unknown_interaction_field");
    if (typeof interaction.interaction_id !== "string" || !interaction.interaction_id
      || interaction.request?.interaction_id !== interaction.interaction_id) fail("interaction_identity_mismatch");
    const tool_call_id = interaction.request?.source?.tool_call_id;
    if (typeof tool_call_id !== "string" || !tool_call_id) fail("interaction_tool_reference_missing");
    const tools = result.filter(part => part.type === "tool" && json_object(part.content).tool_call_id === tool_call_id);
    if (tools.length !== 1) fail("interaction_tool_ownership_ambiguous");
    const tool = tools[0];
    if (row.step_id !== null && row.step_id !== tool.step_id) fail("interaction_step_ownership_ambiguous");
    const content = json_object(tool.content);
    if (content.interactions !== undefined && !Array.isArray(content.interactions)) fail("invalid_tool_interactions");
    const existing = content.interactions ?? [];
    if (existing.some(item => item.interaction_id === interaction.interaction_id)) fail("duplicate_interaction_id");
    content.interactions = [...existing, interaction];
    tool.content = JSON.stringify(content);
    mapping.push({ source_part_id: row.part_id, target_part_id: tool.part_id, relation: "tool_interaction", interaction_index: existing.length, source_sequence: row.sequence, source_step_id: row.step_id, source_created_at: row.created_at, source_updated_at: row.updated_at, source_content_sha256: digest(json_object(row.content)) });
  }
  return result.map((part, index) => ({ ...part, sequence: index + 1 }));
}

/** Build a complete single-library plan; source rows remain available only in private memory. */
export function plan_snapshot(source, selection, runtime, expected, repair_entry) {
  validate_source_structure(source, expected);
  const { snapshot, inbox_messages, audit } = repair_snapshot(source, repair_entry);
  const state = snapshot.tables.session_state[0];
  if (state.agent_id !== selection.agent_id || state.session_id !== selection.session_id) fail("path_session_identity_mismatch");
  if (snapshot.version === 7) return null;
  const tables = Object.fromEntries(canonical_tables.map(table => [table,
    ["messages", "message_parts"].includes(table) ? [] : structuredClone(snapshot.tables[table] ?? []),
  ]));
  const grouped_parts = group_parts_by_message(snapshot.tables.message_parts);
  const source_parts_by_id = new Map(source.tables.message_parts.map(part => [part.part_id, part]));
  tables.messages = [];
  tables.message_parts = [];
  const watermarks = [];
  const message_mapping = [];
  const part_mapping = [];
  const inbox_ids = new Set();
  const part_ids = new Set(snapshot.tables.message_parts.map(part => part.part_id));
  const rows = [...snapshot.tables.messages].sort((left, right) => left.sequence - right.sequence);
  let inbox_count = 0;
  let interaction_count = 0;
  for (const original of rows) {
    const row = { ...original, stable_part_sequence: 0 };
    delete row.visibility;
    if (typeof row.message_id !== "string" || !row.message_id || !Number.isSafeInteger(row.sequence) || row.sequence < 1) fail("invalid_message_identity");
    if (!["visible", "internal"].includes(original.visibility)) fail("invalid_visibility");
    if (row.state === "streaming") fail("streaming_message_requires_review");
    if (!["user", "agent"].includes(row.role)) fail("invalid_message_role");
    const has_origin_session = typeof row.origin_session_id === "string" && row.origin_session_id.length > 0;
    const has_origin_message = typeof row.origin_message_id === "string" && row.origin_message_id.length > 0;
    if (has_origin_session !== has_origin_message || (row.origin_turn_id !== null && !has_origin_session)) fail("incomplete_fork_origin");
    if (row.role === "agent" && (row.meta !== null || original.visibility !== "visible")) fail("unsupported_agent_envelope");
    const meta = row.role === "user" ? read_meta(row, runtime) : undefined;
    let parts = (grouped_parts.get(row.message_id) ?? []).map(part => ({ ...part }));
    if (parts.some(part => typeof part.part_id !== "string" || !part.part_id)) fail("invalid_part_identity");
    if (parts.some((part, index) => part.sequence !== index + 1)) fail("non_contiguous_source_parts");
    if (parts.some(part => part.type === "inbox")) fail("unexpected_inbox_in_legacy_schema");
    const convert = row.role === "user" && (original.visibility === "internal" || ["session", "runtime"].includes(meta?.from.kind) || inbox_messages.has(row.message_id));
    if (row.role === "user" && !meta && !convert && has_background_structure(parts)) fail("visible_unaccounted_background_input");
    const mapping = { source_message_id: row.message_id, target_message_id: row.message_id, source_visibility: original.visibility, actor_kind: meta?.from.kind ?? null, relation: convert ? "inbox_carrier" : "preserved", source_sequence: row.sequence, source_turn_id: row.turn_id };
    if (convert) {
      if (original.state !== null) fail("invalid_user_state");
      const match = /^user-request:([a-f0-9]{64})$/u.exec(row.message_id);
      if (row.message_id.startsWith("user-request:") && !match) fail("malformed_request_message_id");
      const identity_digest = digest([state.agent_id, state.session_id, row.message_id]);
      const inbox_id = match ? `inbox-request:${match[1]}` : `inbox-migration-v7:${identity_digest}`;
      const part_id = `part-migration-v7:${identity_digest}`;
      if (inbox_ids.has(inbox_id) || part_ids.has(part_id)) fail("duplicate_migration_identity");
      inbox_ids.add(inbox_id);
      part_ids.add(part_id);
      const source = causal_source(parts);
      const content = { inbox_id, kind: input_kind(parts, meta), ...(source ? { source } : {}), content: inbox_content(parts), created_at: row.created_at, ...(meta ? { meta } : {}) };
      for (const [index, part] of parts.entries()) {
        part_mapping.push({ source_part_id: part.part_id, target_part_id: part_id, relation: "inbox_content", target_sequence: 1, content_index: index, source_sequence: source_parts_by_id.get(part.part_id).sequence, source_step_id: part.step_id, source_created_at: part.created_at, source_updated_at: part.updated_at, source_content_sha256: digest(json_object(source_parts_by_id.get(part.part_id).content)) });
      }
      parts = [{ part_id, message_id: row.message_id, sequence: 1, step_id: null, type: "inbox", content: JSON.stringify(content), created_at: row.created_at, updated_at: row.updated_at }];
      row.role = "agent";
      row.state = "done";
      row.meta = null;
      mapping.inbox_id = inbox_id;
      inbox_count += 1;
    } else {
      if (row.role === "agent") {
        interaction_count += parts.filter(part => part.type === "interaction").length;
        parts = fold_interactions(parts, part_mapping);
      }
      for (const part of parts) part_mapping.push({ source_part_id: part.part_id, target_part_id: part.part_id, relation: "preserved", source_sequence: source_parts_by_id.get(part.part_id).sequence, target_sequence: part.sequence, source_step_id: part.step_id, source_content_sha256: digest(json_object(source_parts_by_id.get(part.part_id).content)), target_content_sha256: digest(json_object(part.content)) });
    }
    let message;
    try { message = runtime.decode_session_message(row, parts, state.session_id); }
    catch { fail(convert ? "inbox_codec_rejected_content" : "preserved_message_codec_rejected_content"); }
    if (row.role === "agent") watermarks.push([row.message_id, runtime.resolve_stable_part_sequence(message.parts, 0)]);
    tables.messages.push(row);
    tables.message_parts.push(...parts);
    message_mapping.push(mapping);
  }
  // Every source Part must have exactly one explained destination, including folded Parts.
  if (part_mapping.length !== snapshot.tables.message_parts.length || new Set(part_mapping.map(item => item.source_part_id)).size !== part_mapping.length) fail("incomplete_part_mapping");
  const last = tables.messages.at(-1);
  const last_message = last ? runtime.decode_session_message(last, tables.message_parts.filter(part => part.message_id === last.message_id), state.session_id) : null;
  tables.session_state[0].message_count = rows.length;
  tables.session_state[0].preview_text = last_message ? runtime.resolve_session_message_preview(last_message).trim().slice(0, 180) || null : null;
  const manifest = {
    from_version: source.version, target_version: 7, source_fingerprint: source.fingerprint,
    ...(audit.length ? { repairs: audit, repair_entry_sha256: digest(repair_entry) } : {}),
    message_count: rows.length, source_part_count: snapshot.tables.message_parts.length, target_part_count: tables.message_parts.length,
    inbox_count, interaction_count, cleared_derived_tables: derived_tables.filter(table => snapshot.tables[table]),
    message_mapping, part_mapping, stable_prefixes: watermarks.map(([message_id, sequence]) => ({ message_id, stable_part_sequence: sequence })),
  };
  return { source, source_fingerprint: source.fingerprint, tables, watermarks, manifest };
}
