/** Credits 的 Card、Transaction 与钱包投影文档；不把记账写入暴露为用户权限。 */
import type { ApiDocumentation, ApiSchema } from "@downcity/downtown";
import { object_schema as obj, array_schema as arr, items_schema, text_schema as text, enum_schema, number_schema as num, time_schema, metadata_schema, nullable_schema } from "../shared/documentation.js";

const user_id = text("Downtown user ID");
const card_id = text("Ephemeral card ID; primary card uses user_id");
const transaction_id = text("Transaction ID");
const kind = enum_schema("topup", "charge");
const credits = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const limit = { type: ["integer", "string"], description: "Converted to a number, default 100; truncated and clamped to 1–500; nonfinite values use default" };
const primary = obj({ kind: { const: "primary" }, user_id, credits: num, created_at: time_schema, updated_at: time_schema });
const ephemeral_fields = { kind: { const: "ephemeral" }, card_id, user_id, name: text("Card display name"), credits: num, expires_at: time_schema, source: text("Issuing source"), ref: text("External reference"), created_at: time_schema, updated_at: time_schema, status: enum_schema("active", "depleted", "expired") };
const ephemeral = obj(ephemeral_fields);
const account = obj({ user_id, available_credits: num, cards: obj({ primary, ephemeral: arr(ephemeral) }) });
const transaction = obj({ transaction_id, kind, user_id, credits, status: enum_schema("pending", "applied"), idempotency_key: text("Stable key within transaction kind"), source: text("Business source"), ref: text("External reference"), note: text("Audit note"), metadata_json: text("Serialized audit JSON"), created_at: time_schema, applied_at: nullable_schema(time_schema) });
const entry_fields = { entry_id: text("Immutable entry ID"), transaction_id, user_id, card_kind: enum_schema("primary", "ephemeral"), card_id, credits_delta: num, credits_after: num, created_at: time_schema };
const entry = obj(entry_fields);
const card = { anyOf: [obj({ kind: { const: "primary" }, user_id }), obj({ kind: { const: "ephemeral" }, card_id })] };
const audit = { source: text("Required business source"), ref: text("External reference"), idempotency_key: text("Stable key; reuse only for identical parameters"), note: text("Audit note"), metadata: metadata_schema };
const query = { user_id, kind, limit };
const history_query = { user_id, transaction_id, limit };
const auth_errors = [{ status: 401, description: "User or admin authentication required as declared by the route" }];
const input_errors = [...auth_errors, { status: 400, description: "Malformed JSON object request" }, { status: 500, description: "Required text, card reference, timestamp, credits or transaction kind failed validation; current handlers throw uncategorized TypeError" }];
const write_errors = [...input_errors, { status: 404, description: "Referenced ephemeral card does not exist" }, { status: 409, description: "Idempotency key parameters differ, card expired, balance/card-count limit exceeded, or concurrent update prevented application" }];

function document(description: string, request_schema: ApiSchema | undefined, response_schema: ApiSchema, request: unknown, errors = input_errors): ApiDocumentation {
  return { description, request_schema: request_schema ?? obj({}, []), response_schema, errors, examples: [{ name: "Example request", request: request ?? {} }] };
}

/** 16 个公开 HTTP 入口的具体契约。 */
export const credits_documentation: Record<string, ApiDocumentation> = {
  "/wallet/me": document("Read own safe wallet projection, including historical ephemeral cards reconstructed from immutable entries. Primary and available balance reflect current state.", undefined, obj({ available_credits: num, primary, cards: arr(obj(Object.fromEntries(Object.entries(ephemeral_fields).filter(([key]) => !["user_id", "source", "ref"].includes(key))))) }), undefined, auth_errors),
  "/cards/entries/me": document("Read own card's safe immutable entries newest first. Primary card_id equals user_id; historical ephemeral ownership is checked against entries.", obj({ card_id, limit }, ["card_id"]), items_schema(obj(Object.fromEntries(Object.entries(entry_fields).filter(([key]) => key !== "user_id")))), { card_id: "card_example", limit: 20 }, [...input_errors, { status: 404, description: "Card does not belong to the caller" }]),
  "/me": document("Read own current account. May create a zero-balance primary card and clean expired ephemeral cards. Active ephemeral cards are ordered by expiry.", undefined, account, undefined, auth_errors),
  "/transactions/me": document("Read own transactions, newest first; optional kind filter.", obj({ kind, limit }, []), items_schema(transaction), { kind: "charge", limit: 20 }),
  "/history/me": document("Read own immutable transaction entries, newest first; optional transaction filter.", obj({ transaction_id, limit }, []), items_schema(entry), { limit: 20 }),
  "/users": document("Admin: list users with a primary card and summarize their current balance.", obj({ limit }, []), items_schema(obj({ user_id, available_credits: num, primary_credits: num, ephemeral_credits: num, active_ephemeral_cards: num })), { limit: 100 }),
  "/users/get": document("Admin: read a user's current account, creating the primary card when absent.", obj({ user_id }), account, { user_id: "user_example" }),
  "/cards/primary": document("Admin: read or create the user's permanent primary card; expired cards are cleaned first.", obj({ user_id }), primary, { user_id: "user_example" }),
  "/cards/ephemeral/get": document("Admin: read a stored ephemeral card by ID.", obj({ card_id }), ephemeral, { card_id: "card_example" }, [...input_errors, { status: 404, description: "Ephemeral card does not exist" }]),
  "/cards/ephemeral": document("Admin: list stored ephemeral cards. Excludes expired and depleted cards unless include_history=true; deleted expired cards are not reconstructed here.", obj({ user_id, include_history: { type: "boolean" }, limit }, []), items_schema(ephemeral), { user_id: "user_example", include_history: true }),
  "/transactions": document("Admin: list transactions across users, newest first.", obj(query, []), items_schema(transaction), { user_id: "user_example", kind: "topup" }),
  "/transactions/get": document("Admin: read a transaction by ID.", obj({ transaction_id }), transaction, { transaction_id: "txn_example" }, [...input_errors, { status: 404, description: "Transaction does not exist" }]),
  "/history": document("Admin: list immutable card entries, optionally filtering by user and transaction.", obj(history_query, []), items_schema(entry), { user_id: "user_example", limit: 100 }),
  "/cards/ephemeral/create": document("Admin: atomically create a future-expiring card and initial topup. At most 100 active positive-balance ephemeral cards per user; total balance must fit a safe integer.", obj({ user_id, name: text("Card display name"), initial_credits: credits, expires_at: { type: "string", format: "date-time", description: "Must be in the future for a new operation" }, ...audit }, ["user_id", "name", "initial_credits", "expires_at", "source", "idempotency_key"]), ephemeral, { user_id: "user_example", name: "Trial", initial_credits: 1000, expires_at: "2099-01-01T00:00:00.000Z", source: "promotion", idempotency_key: "trial:user_example" }, write_errors),
  "/topups/create": document("Admin: atomically top up a selected card and append immutable entries. Identical idempotency retries return the original transaction.", obj({ card, credits, ...audit }, ["card", "credits", "source", "idempotency_key"]), transaction, { card: { kind: "primary", user_id: "user_example" }, credits: 1000, source: "payment", idempotency_key: "payment:example" }, write_errors),
  "/charges/create": document("Admin: charge a user atomically. Automatic allocation spends earliest-expiring ephemeral cards before primary. A selected card must belong to the user; overdraft is forbidden.", obj({ user_id, card, credits, ...audit }, ["user_id", "credits", "source", "idempotency_key"]), transaction, { user_id: "user_example", credits: 10, source: "ai", idempotency_key: "usage:example" }, [...write_errors, { status: 402, description: "Insufficient balance in the user wallet or selected card" }, { status: 403, description: "Selected card belongs to another user" }]),
};
