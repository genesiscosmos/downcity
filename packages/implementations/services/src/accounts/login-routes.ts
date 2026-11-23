/** Public login protocol. Claim credentials travel only in JSON bodies; status never delivers tokens. */
import type { ApiDocumentation, ServiceInstallContext } from "@downcity/downtown";
import { httpError } from "@downcity/downtown";
import type { AccountsRuntime } from "./AccountsRuntime.js";
import type { AccountsLoginContinueRequest, AccountsLoginStartRequest, AccountsLoginExchangeRequest } from "./types.js";
import { toRecord } from "./utils.js";

/** 注册登录、状态查询、授权码交换及 Provider 浏览器入口。 */
export function register_login_routes(runtime: AccountsRuntime, ctx: ServiceInstallContext, accounts_documentation: Record<string, ApiDocumentation>): void {
  ctx.route({
    method: "POST", path: "/login/start", public: true,
    documentation: accounts_documentation["/login/start"],
    handler: async (request_ctx) => {
      const body = await request_ctx.json<AccountsLoginStartRequest>();
      const provider_id = String(body.provider ?? "");
      const provider = runtime.login_provider(provider_id);
      if (!provider) throw httpError(400, "login provider is not enabled");
      const { cookie, ...proof } = await runtime.flow.start(provider_id, body.client_type, request_ctx.request, body);
      const headers = new Headers({ "cache-control": "no-store" });
      if (cookie) headers.set("set-cookie", cookie);
      if (provider_id === "local") {
        await runtime.flow.ready(proof.login_id, "created", await runtime.local_login_token(ctx));
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
    documentation: accounts_documentation["/login/continue"],
    handler: async (request_ctx) => {
      const body = await request_ctx.json<AccountsLoginContinueRequest>();
      const row = await runtime.flow.claim(String(body.login_id ?? ""), String(body.login_secret ?? ""), request_ctx.request);
      if (row.provider !== "email") throw httpError(400, "this provider does not accept input");
      if (!await runtime.flow.advance(row.login_id, "created", "verifying")) throw httpError(409, "login already in progress");
      const input = toRecord(body.input);
      const result = await runtime.create_email_login_token(ctx, {
        email: input?.email, password: input?.password,
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
    documentation: accounts_documentation["/login/result"],
    handler: async (request_ctx) => {
      const body = await request_ctx.json<AccountsLoginContinueRequest>();
      const row = await runtime.flow.claim(String(body.login_id ?? ""), String(body.login_secret ?? ""), request_ctx.request);
      return Response.json({ status: row.phase === "exchanged" || (row.phase === "done" && !row.redirect_uri) ? "done" : "pending",
        login_id: row.login_id, provider: row.provider }, { headers: { "cache-control": "no-store" } });
    },
  });
  ctx.route({
    method: "POST", path: "/login/exchange", public: true,
    documentation: accounts_documentation["/login/exchange"],
    handler: async (request_ctx) => {
      const body = await request_ctx.json<AccountsLoginExchangeRequest>();
      const row = await runtime.flow.claim(String(body.login_id ?? ""), String(body.login_secret ?? ""), request_ctx.request);
      return Response.json(await runtime.exchange_login(row, body), { headers: { "cache-control": "no-store" } });
    },
  });
  ctx.route({ method: "GET", path: "/oauth/authorize", public: true, documentation: accounts_documentation["/oauth/authorize"], handler: {
    request: async (request) => await runtime.authorize_oauth(new URL(request.url).searchParams.get("login_id") ?? "", request),
  } });
}
