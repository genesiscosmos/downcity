/**
 * Accounts 注册文档：显式描述私密登录证明、设备凭证轮换和浏览器 OAuth 协议。
 * 示例全部使用公开占位值，不能作为真实密码、Token 或 PKCE 证明使用。
 */
import type { ApiDocumentation } from "@downcity/downtown";
import { object_schema as obj, array_schema as arr, items_schema, text_schema as text, enum_schema, time_schema, metadata_schema, nullable_schema as nullable } from "../shared/documentation.js";

const login_id = text("Short-lived login transaction ID");
const provider = text("Enabled provider ID returned by providers");
const proof_fields = { login_id, login_secret: text("Private initiating-client proof; JSON only, never URLs or logs") };
const proof = obj(proof_fields);
const progress_fields = { login_id, provider, status: enum_schema("pending", "done") };
const input = obj({ name: text("Input field key"), type: enum_schema("text", "password"), label: text("Display label"), required: { type: "boolean" } });
const credentials_fields = { user_token: text("Private Bearer access JWT"), refresh_token: text("Private rotating refresh credential"), expires_at: time_schema, refresh_expires_at: time_schema, session_id: text("Device session ID") };
const credentials = obj(credentials_fields);
const issue = obj({ user_token: credentials_fields.user_token, user_id: text("Authenticated user ID"), expires_at: time_schema });
const flow_errors = [{ status: 400, description: "Invalid provider, client parameters, input or exchange ID" }, { status: 403, description: "Invalid login secret, origin, browser cookie or OAuth code/PKCE proof" }, { status: 404, description: "Login is invalid or expired (five-minute initial lifetime)" }, { status: 409, description: "Login phase changed, not ready, in progress or already exchanged using another exchange_id" }];
const admin_errors = [{ status: 401, description: "Valid admin session required" }];
const profile = obj({ user_id: text("User ID"), email: text("Email"), display_name: text("Display name"), avatar_url: text("Avatar URL"), bio: text("Biography"), created_at: time_schema, updated_at: time_schema });
const sql_time = { anyOf: [{ type: "string" }, { type: "number" }], description: "Database-driver timestamp representation" };
const sql_text = nullable(text("Database value; null when no profile exists"));

/** 所有 Accounts action 和 native route 的协议契约。 */
export const accounts_documentation: Record<string, ApiDocumentation> = {
  "/login/start": {
    description: "Start a five-minute login. Preserve login_secret privately. Email/local web requests require same-origin Origin and receive a binding cookie. Every OAuth client must supply trusted redirect_uri, random state and S256 PKCE; start never returns a token.",
    request_schema: obj({ provider, client_type: enum_schema("web", "cli", "desktop"), redirect_uri: { type: "string", format: "uri", description: "Required for OAuth: exact trusted web callback or CLI/Desktop IPv4 loopback callback" }, state: { type: "string", minLength: 32, description: "Required random URL-safe OAuth product state" }, code_challenge: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" }, code_challenge_method: { const: "S256" } }, ["provider", "client_type"]),
    response_schema: obj({ ...proof_fields, provider, status: enum_schema("input_required", "redirect_required", "done"), inputs: arr(input), url: text("Browser authorization URL, only for redirect_required") }, ["login_id", "login_secret", "provider", "status"]), errors: flow_errors,
    examples: [{ name: "Email login on desktop", request: { provider: "email", client_type: "desktop" }, response: { login_id: "login_example", login_secret: "PRIVATE_PLACEHOLDER", provider: "email", status: "input_required", inputs: [{ name: "email", type: "text", label: "Email", required: true }, { name: "password", type: "password", label: "Password", required: true }] } }],
  },
  "/login/continue": {
    description: "Continue email login using the private proof and verified email/password. Web also requires original same-origin cookie. Returns progress only; exchange retrieves credentials.", request_schema: obj({ ...proof_fields, input: obj({ email: text("Email"), password: text("Private password") }) }), response_schema: obj({ login_id, provider, status: { const: "done" } }),
    errors: [...flow_errors, { status: 401, description: "Email/password invalid or email not verified" }, { status: 500, description: "Authentication or storage operation failed" }], examples: [{ name: "Verify email credentials", request: { login_id: "login_example", login_secret: "PRIVATE_PLACEHOLDER", input: { email: "user@example.com", password: "PASSWORD_PLACEHOLDER" } } }],
  },
  "/login/result": {
    description: "Read login progress using private proof; never returns authorization codes or tokens. OAuth stays pending until exchange completes.", request_schema: proof, response_schema: obj(progress_fields), errors: flow_errors, examples: [{ name: "Poll progress", request: { login_id: "login_example", login_secret: "PRIVATE_PLACEHOLDER" }, response: { login_id: "login_example", provider: "github", status: "pending" } }],
  },
  "/login/exchange": {
    description: "Exchange ready login once. Generate and persist exchange_id before requesting; retries must reuse it within 60 seconds. OAuth additionally requires product callback authorization_code and original PKCE verifier. Web receives user_token; CLI/Desktop also receive rotating device-session credentials.",
    request_schema: obj({ ...proof_fields, exchange_id: { type: "string", pattern: "^[A-Za-z0-9_-]{20,128}$" }, authorization_code: text("OAuth product callback code"), code_verifier: text("Original private S256 PKCE verifier, OAuth only") }, ["login_id", "login_secret", "exchange_id"]),
    response_schema: obj({ ...progress_fields, status: { const: "done" }, ...credentials_fields }, ["login_id", "provider", "status", "user_token"]), errors: flow_errors,
    examples: [{ name: "Email exchange", request: { login_id: "login_example", login_secret: "PRIVATE_PLACEHOLDER", exchange_id: "public_example_exchange_1234" } }],
  },
  "/refresh": {
    description: "Rotate device-session credentials using refresh_token and a persisted random refresh_id. Repeat the same refresh_id after transport failure. No Bearer token required; responses use Cache-Control: no-store.", request_schema: obj({ refresh_token: credentials_fields.refresh_token, refresh_id: { type: "string", pattern: "^[A-Za-z0-9_-]{20,128}$", description: "Persist and reuse for this rotation's transport retries" } }), response_schema: credentials,
    errors: [{ status: 400, description: "Missing/invalid refresh request ID" }, { status: 401, description: "Refresh credential expired, revoked or invalid" }], examples: [{ name: "Rotate device session", request: { refresh_token: "PRIVATE_PLACEHOLDER", refresh_id: "public_example_refresh_1234" } }],
  },
  "/register": {
    description: "Register with enabled email provider, persist profile and send verification email. Does not sign in. Name defaults to the email local part.", request_schema: obj({ email: text("Email containing @"), password: { type: "string", minLength: 8 }, name: text("Optional display name") }, ["email", "password"]), response_schema: obj({ success: { const: true }, message: { const: "verification email sent" }, user_id: text("Registered user ID when returned by auth provider") }, ["success", "message"]),
    errors: [{ status: 400, description: "Email provider disabled, invalid email or password shorter than eight characters" }, { status: 422, description: "Registration rejected by better-auth, e.g. duplicate account" }, { status: 500, description: "Registration, profile persistence or email sending failed" }], examples: [{ name: "Register email", request: { email: "user@example.com", password: "PASSWORD_PLACEHOLDER", name: "Example" } }],
  },
  "/verify-email": {
    description: "Verify email ownership with email verification token. Successful verification requires a subsequent password login; no user token is returned.", request_schema: obj({ token: text("Private verification token from email") }), response_schema: obj({ success: { const: true }, message: { const: "email verified; sign in with your password" } }), errors: [{ status: 400, description: "Email provider disabled, missing, invalid or expired verification token" }, { status: 500, description: "Verification provider operation failed" }], examples: [{ name: "Verify ownership", request: { token: "PRIVATE_PLACEHOLDER" } }],
  },
  "/providers": {
    request_schema: obj({}, []),
    description: "List locally enabled login providers. Local-login mode returns only local. Disabled providers are omitted; availability does not guarantee external provider connectivity.", response_schema: items_schema(obj({ id: provider, type: enum_schema("oauth", "input"), enabled: { type: "boolean" }, label: text("Display label"), inputs: arr(input), login_enabled: { type: "boolean" }, register_enabled: { type: "boolean" }, reason: enum_schema("not_configured", "not_supported") }, ["id", "type", "enabled", "label", "inputs"])), examples: [{ name: "No configured providers", response: { items: [] } }],
  },
  "/me": {
    request_schema: obj({}, []),
    description: "Read authenticated user-token identity and optional stored profile; profile is null if no profile record exists.", response_schema: obj({ user: obj({ user_id: text("Token subject"), metadata: metadata_schema }, ["user_id"]), profile: nullable(profile) }), errors: [{ status: 401, description: "Valid user token required" }], examples: [{ name: "Current user", response: { user: { user_id: "user_example" }, profile: null } }],
  },
  "/tokens/issue": {
    description: "Admin: issue a user token for the supplied user_id and optional metadata/TTL. Does not verify an email identity or create a device session.", request_schema: obj({ user_id: text("Nonempty target user ID"), metadata: metadata_schema, ttl: { type: ["string", "number"], description: "Duration such as 30m, 1h, 7d or seconds; defaults to configured token_ttl" } }, ["user_id"]), response_schema: issue, errors: [...admin_errors, { status: 400, description: "user_id is empty or TTL invalid" }], examples: [{ name: "Issue scoped token", request: { user_id: "user_example", ttl: "1h" } }],
  },
  "/logout": {
    description: "Revoke entire device session when refresh_token is supplied; otherwise require Authorization: Bearer user_token and revoke that token's jti. Empty JSON is valid only with Bearer authorization.", request_schema: obj({ refresh_token: credentials_fields.refresh_token }, []), response_schema: obj({ success: { const: true } }), errors: [{ status: 401, description: "Missing Bearer token or invalid revocation credential" }], examples: [{ name: "Log out device", request: { refresh_token: "PRIVATE_PLACEHOLDER" }, response: { success: true } }],
  },
  "/users": {
    request_schema: obj({}, []),
    description: "Admin: list better-auth users joined to optional profiles, newest first. Query failures currently return items=[]; an empty list does not prove the database has no users.", response_schema: items_schema(obj({ user_id: text("Auth user ID"), auth_email: text("Auth email"), email_verified: { type: ["boolean", "number"] }, auth_name: text("Auth display name"), auth_image: nullable(text("Auth image")), auth_created_at: sql_time, auth_updated_at: sql_time, profile_email: sql_text, display_name: sql_text, avatar_url: sql_text, bio: sql_text, profile_created_at: nullable(sql_time), profile_updated_at: nullable(sql_time) })), errors: admin_errors, examples: [{ name: "Empty result", response: { items: [] } }],
  },
  "/sessions": {
    request_schema: obj({}, []),
    description: "Admin: list better-auth sessions by expiry descending (separate from rotating device sessions). Query failures currently return items=[].", response_schema: items_schema(obj({ session_id: text("better-auth session ID"), user_id: text("User ID"), expires_at: sql_time, created_at: sql_time, status: enum_schema("active", "expired") })), errors: admin_errors, examples: [{ name: "Empty result", response: { items: [] } }],
  },
  "/oauth/authorize": {
    description: "Public native GET browser entry. Bind the browser using an HttpOnly cookie, then 303 redirect to the configured OAuth provider. No Bearer auth; login_id must refer to a created unexpired OAuth flow. HTTPS required except local development.", protocol: "oauth", response_status: 303, response_schema: { type: "null", description: "Empty redirect body; Location points to the OAuth provider" }, response_content: {}, request_schema: obj({ login_id }), errors: flow_errors, requirements: ["Configured OAuth provider", "Browser cookies", "Public callback URL /v1/accounts/oauth/callback"], examples: [{ name: "Open in browser", request: { login_id: "login_example" } }],
  },
  "/oauth/callback": {
    description: "Public native GET callback from OAuth provider. Requires exactly one state and code and the original browser cookie; provider authorization is exchanged server-side. Successful 303 redirects to the trusted product callback with code and product state. Errors return an HTML page (400). Never delivers a user token in the URL.", protocol: "oauth", response_status: 303, response_schema: { type: "null", description: "Empty redirect body; Location points to the trusted product callback with code and state" }, response_content: {}, request_schema: obj({ state: text("Provider OAuth state"), code: text("Provider authorization code"), error: text("Provider failure code"), error_description: text("Provider failure description") }, []), errors: [{ status: 400, description: "Provider rejection, invalid state/code, browser binding failure or OAuth exchange failure; HTML response" }], examples: [{ name: "Provider callback", request: { state: "PROVIDER_STATE_PLACEHOLDER", code: "PROVIDER_CODE_PLACEHOLDER" } }],
  },
  "/auth/*": {
    description: "Public native ALL route with better-auth HTTP semantics. Only GET /auth/verify-email?token=... is accepted by this runtime; other suffixes/methods return 404 text. Verification returns JSON with no-store and never signs in.", protocol: "better-auth", response_content_type: "application/json", request_schema: obj({ token: text("Email verification token for GET verify-email") }), response_schema: obj({ success: { const: true }, message: text("Verification confirmation") }), errors: [{ status: 400, description: "Missing/invalid/expired email token" }, { status: 404, description: "All other native auth routes or methods are disabled" }, { status: 500, description: "Verification operation failed" }], examples: [{ name: "Verify-email query", request: { token: "PRIVATE_PLACEHOLDER" } }],
  },
};
