/** Public login protocol. Claim credentials travel only in JSON bodies; status never delivers tokens. */
import type { ServiceInstallContext } from "@downcity/federation";
import { httpError } from "@downcity/federation";
import type { AccountsRuntime } from "./AccountsRuntime.js";
import type { AccountsLoginContinueRequest, AccountsLoginStartRequest, AccountsLoginExchangeRequest } from "./types.js";
import { toRecord } from "./utils.js";

/** Register login and browser consent routes separately from administrative/token routes. */
export function register_login_routes(runtime: AccountsRuntime, ctx: ServiceInstallContext): void {
  ctx.route({
    method: "POST", path: "/login/start", public: true,
    handler: async (request_ctx) => {
      const body = await request_ctx.json<AccountsLoginStartRequest>();
      const provider_id = String(body.provider ?? "");
      const bureau_id = String(body.bureau_id ?? "");
      await runtime.require_active_bureau(bureau_id);
      const provider = runtime.login_provider(provider_id);
      if (!provider) throw httpError(400, "login provider is not enabled");
      const { cookie, ...proof } = await runtime.flow.start(bureau_id, provider_id, body.client_type, request_ctx.request);
      const headers = new Headers({ "cache-control": "no-store" });
      if (cookie) headers.set("set-cookie", cookie);
      if (provider_id === "local") {
        await runtime.flow.ready(proof.login_id, "created", await runtime.local_login_token(ctx, bureau_id));
        return Response.json({ ...proof, provider: provider_id, status: "done" }, { headers });
      }
      if (provider_id === "email") {
        return Response.json({ ...proof, provider: provider_id, status: "input_required", inputs: provider.inputs }, { headers });
      }
      return Response.json({ ...proof, provider: provider_id, status: "redirect_required",
        url: `${new URL(request_ctx.request.url).origin}/v1/accounts/oauth/authorize?login_id=${encodeURIComponent(proof.login_id)}` }, { headers });
    },
  });
  ctx.route({
    method: "POST", path: "/login/continue", public: true,
    handler: async (request_ctx) => {
      const body = await request_ctx.json<AccountsLoginContinueRequest>();
      const row = await runtime.flow.claim(String(body.login_id ?? ""), String(body.login_secret ?? ""), request_ctx.request);
      if (row.provider !== "email") throw httpError(400, "this provider does not accept input");
      await runtime.require_active_bureau(row.bureau_id);
      if (!await runtime.flow.advance(row.login_id, "created", "verifying")) throw httpError(409, "login already in progress");
      const input = toRecord(body.input);
      const result = await runtime.create_email_login_token(ctx, {
        email: input?.email, password: input?.password, bureau_id: row.bureau_id,
      });
      if ("error" in result) {
        await runtime.flow.advance(row.login_id, "verifying", "created");
        return Response.json({ error: result.error }, { status: result.status, headers: { "cache-control": "no-store" } });
      }
      await runtime.flow.ready(row.login_id, "verifying", result.user_token);
      return Response.json({ status: "done", login_id: row.login_id, provider: row.provider }, { headers: { "cache-control": "no-store" } });
    },
  });
  ctx.route({
    method: "POST", path: "/login/result", public: true,
    handler: async (request_ctx) => {
      const body = await request_ctx.json<AccountsLoginContinueRequest>();
      const row = await runtime.flow.claim(String(body.login_id ?? ""), String(body.login_secret ?? ""), request_ctx.request);
      return Response.json({ status: row.phase === "done" || row.phase === "exchanged" ? "done" : "pending",
        login_id: row.login_id, provider: row.provider }, { headers: { "cache-control": "no-store" } });
    },
  });
  ctx.route({
    method: "POST", path: "/login/exchange", public: true,
    handler: async (request_ctx) => {
      const body = await request_ctx.json<AccountsLoginExchangeRequest>();
      const row = await runtime.flow.claim(String(body.login_id ?? ""), String(body.login_secret ?? ""), request_ctx.request);
      await runtime.require_active_bureau(row.bureau_id);
      return Response.json(await runtime.flow.exchange(row, String(body.exchange_id ?? "")), { headers: { "cache-control": "no-store" } });
    },
  });
  ctx.route({ method: "GET", path: "/oauth/authorize", public: true, handler: {
    request: async (request) => await runtime.authorize_oauth(new URL(request.url).searchParams.get("login_id") ?? "", request),
  } });
  ctx.route({ method: "POST", path: "/oauth/confirm", public: true, handler: {
    request: async (request) => await runtime.confirm_oauth(request),
  } });
}
