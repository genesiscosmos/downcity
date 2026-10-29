/**
 * 中转渠道路由与有限故障恢复。
 * 路由只做配置过滤和 priority_weighted 抽样，不调用判定模型。健康状态以
 * 数据库冷却截止时间为准；到期后的正常流量承担恢复探测。只有适配器明确
 * 返回、可确认未生成的拒绝响应允许切换；网络异常、5xx 和流中断保持未知，
 * 绝不透明重新生成。每次尝试在发起上游请求前落库。
 */
import type { ModelCall, ModelStreamEvent } from "@downcity/type";
import { query_service_database } from "../ai/database-sql.js";
import type { Context } from "../service.js";
import type { AIChannelStreamResult, AIModelDefinition } from "../../types/AI.js";
import type {
  RelayAttemptRecord, RelayCatalog, RelayDeployment, RelayPrincipal,
  RelayRequestRecord, RelayHealthRecord, RelayUpstreamFailure,
} from "../../types/Relay.js";
import type { RelayInitialization } from "../../types/Relay.js";
import { httpError } from "../../utils/helpers.js";
import { stream_openai_compatible_model } from "../ai/OpenAICompatibleModelAdapter.js";
import { read_resolved_reasoning } from "../ai/reasoning.js";

/** 在最高优先级候选内进行加权抽样。 */
function select_deployment(candidates: RelayDeployment[]): RelayDeployment {
  const priority = Math.max(...candidates.map((item) => item.priority));
  const tier = candidates.filter((item) => item.priority === priority);
  const total = tier.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * total;
  for (const item of tier) {
    cursor -= item.weight;
    if (cursor < 0) return item;
  }
  return tier[tier.length - 1]!;
}

/** 已初始化的 SDK 渠道路由器。 */
export class RelayRouter {
  constructor(private readonly dependencies: RelayInitialization) {}

  /** 生成运行时模型包装，统一入口能力和售价，不执行媒体模型 fallback。 */
  resolve(ctx: Context, requested_model: string, catalog: RelayCatalog): AIModelDefinition {
    const route = catalog.routes.find((item) => item.id === requested_model);
    if (route && !route.enabled) throw httpError(404, "Route is disabled");
    const model = catalog.models.find((item) => item.id === (route?.model_id ?? requested_model));
    if (!model?.enabled) throw httpError(404, "Model is unavailable");
    const template = this.dependencies.models.find((item) => item.id === model.template_model_id);
    if (!template?.runtime.stream) throw httpError(503, "Model template is unavailable");
    const principal = ctx.locals.relay_principal as RelayPrincipal | undefined;
    if (principal && !principal.allowed_models.includes("*") && !principal.allowed_models.includes(requested_model)) {
      throw httpError(403, "API Key cannot access this model or route");
    }
    const request_id = typeof ctx.locals.relay_request_id === "string"
      ? ctx.locals.relay_request_id : `req_${crypto.randomUUID()}`;
    ctx.locals.ai_usage_id = request_id;
    ctx.locals.relay_request_id = request_id;
    ctx.locals.relay_template_model_id = template.id;
    ctx.locals.relay_pricing = template.pricing ? structuredClone(template.pricing) : null;
    return {
      ...template, id: requested_model,
      runtime: {
        actions: {},
        stream: async (execution_ctx, call) => {
          // 公开入口保持所购模型语义。历史媒体仍使用已有执行视图；最新媒体
          // 若需要跨模型 fallback，则要求调用者显式选择具备该能力的模型。
          const latest_user = [...call.messages].reverse().find((message) => message.role === "user");
          const unsupported = latest_user?.content.some((part) => part.type === "file" &&
            template.fallback?.some((rule) => {
              try { return rule.match(part); } catch { return true; }
            }));
          if (unsupported) throw httpError(422, "Select a model that supports the requested media");
          return await this.execute(
            execution_ctx, call, catalog, model.id, requested_model,
            route?.deployment_ids, route?.max_attempts ?? 2,
          );
        },
      },
    };
  }

  private async execute(
    ctx: Context, call: ModelCall, catalog: RelayCatalog, model_id: string,
    requested_model: string, deployment_ids: string[] | undefined, max_attempts: number,
  ): Promise<AIChannelStreamResult> {
    const request_id = String(ctx.locals.relay_request_id);
    const started_at = ctx.started_at?.getTime() ?? Date.now();
    const principal = ctx.locals.relay_principal as RelayPrincipal | undefined;
    const requests = this.dependencies.table<RelayRequestRecord>("relay_requests");
    const attempts = this.dependencies.table<RelayAttemptRecord>("relay_attempts");
    const request: RelayRequestRecord = {
      request_id, user_id: ctx.user?.user_id ?? "", key_id: principal?.key_id ?? null,
      requested_model, model_id, status: "running", started_at: new Date(started_at).toISOString(), completed_at: null,
    };
    let candidates = catalog.deployments.filter((item) => {
      if (!item.enabled || item.model_id !== model_id || (deployment_ids && !deployment_ids.includes(item.id))) return false;
      const channel = catalog.channels.find((entry) => entry.id === item.channel_id);
      if (!channel?.enabled) return false;
      if (channel.adapter === "openai_chat_completions") return Boolean(ctx.env(channel.credential_env!));
      const runtime = this.dependencies.models.find((entry) => entry.id === item.runtime_model_id);
      return Boolean(runtime?.runtime.stream && Object.keys(runtime.env ?? {}).every((key) => ctx.env(key)));
    });
    // 日志写入和共享健康读取相互独立，并行完成后才调用上游。
    const [, health] = await Promise.all([
      requests.insert(request),
      query_service_database<RelayHealthRecord>(this.dependencies.database, {
        sql: `SELECT deployment_id, cooldown_until FROM service_ai_relay_health
          WHERE cooldown_until > ? AND deployment_id IN (${this.dependencies.database.schema_id === "postgresql"
            ? "SELECT jsonb_array_elements_text(CAST(? AS jsonb))"
            : "SELECT value FROM json_each(?)"})`,
        params: [Date.now(), JSON.stringify(candidates.map((item) => item.id))],
      }),
    ]);
    const cooling = new Set(health.rows.map((row) => row.deployment_id));
    candidates = candidates.filter((item) => !cooling.has(item.id));
    let last_status = 503;
    for (let index = 0; index < max_attempts && candidates.length; index += 1) {
      if (ctx.request?.signal.aborted) break;
      const deployment = select_deployment(candidates);
      candidates = candidates.filter((item) => item.id !== deployment.id);
      const channel = catalog.channels.find((item) => item.id === deployment.channel_id)!;
      const attempt: RelayAttemptRecord = {
        attempt_id: `att_${crypto.randomUUID()}`, request_id, deployment_id: deployment.id,
        channel_id: channel.id, upstream_model: deployment.upstream_model,
        status: "running", started_at: new Date().toISOString(), completed_at: null,
        http_status: null, first_output_ms: null,
      };
      await attempts.insert(attempt);
      ctx.variant = { ...ctx.variant!, channel_id: channel.id, upstream_model: deployment.upstream_model };
      ctx.metering = {
        ...ctx.metering, channel_id: channel.id, upstream_model: deployment.upstream_model,
        metadata: {
          ...ctx.metering?.metadata, request_id, attempt_id: attempt.attempt_id,
          ...(principal ? { api_key_id: principal.key_id } : {}),
          deployment_id: deployment.id, route_strategy: "priority_weighted",
        },
      };
      try {
        const deadline = AbortSignal.timeout(channel.timeout_ms ?? 120_000);
        ctx.abort_signal = ctx.request?.signal ? AbortSignal.any([ctx.request.signal, deadline]) : deadline;
        const reasoning = read_resolved_reasoning(ctx);
        const result = channel.adapter === "registered"
          ? await this.dependencies.models.find((item) => item.id === deployment.runtime_model_id)!.runtime.stream!(ctx, call)
          : await stream_openai_compatible_model({
              call, model: { id: requested_model, upstream_model: deployment.upstream_model }, env: ctx.env,
              ...(reasoning ? { reasoning } : {}),
              abort_signal: ctx.abort_signal,
            }, { base_url: channel.base_url!, api_key: ctx.env(channel.credential_env!)! });
        return { ...result, stream: this.observe_stream(ctx, result.stream, attempt, started_at) };
      } catch (error) {
        const detail: RelayUpstreamFailure = error && typeof error === "object" ? error : {};
        const status = detail.statusCode;
        const safe_retry = detail.upstream_rejected === true && [401, 403, 429].includes(status ?? 0);
        const cancelled = ctx.request?.signal.aborted === true;
        await attempts.update({ where: { attempt_id: attempt.attempt_id }, values: {
          completed_at: new Date().toISOString(), http_status: status ?? null,
          status: cancelled ? "cancelled" : detail.upstream_rejected ? "rejected" : "unknown",
        } });
        if (status === undefined || [401, 403, 429].includes(status) || status >= 500) {
          const cooldown_ms = status === 429 ? detail.retry_after_ms ?? 30_000 : status && status < 500 ? 60_000 : 15_000;
          await this.cooldown(deployment.id, cooldown_ms);
        }
        last_status = status && status >= 400 && status <= 599 && ![401, 403].includes(status) ? status : 502;
        if (!safe_retry || cancelled) {
          await this.finish_request(request_id, cancelled ? "cancelled" : detail.upstream_rejected ? "failed" : "unknown");
          throw httpError(cancelled ? 499 : last_status, cancelled ? "Request cancelled"
            : detail.upstream_rejected ? "Upstream rejected request" : "Upstream request failed; result may be unknown");
        }
      }
    }
    const cancelled = ctx.request?.signal.aborted === true;
    await this.finish_request(request_id, cancelled ? "cancelled" : "failed");
    throw httpError(cancelled ? 499 : last_status, cancelled ? "Request cancelled" : "No available relay deployment");
  }

  /** 流仅观察一次，不缓冲内容，也不在任何流错误后重启上游。 */
  private observe_stream(
    ctx: Context, stream: ReadableStream<ModelStreamEvent>, attempt: RelayAttemptRecord, started_at: number,
  ): ReadableStream<ModelStreamEvent> {
    const reader = stream.getReader();
    let status = "unknown";
    let first_output_ms: number | null = null;
    let finished = false;
    const finish = async (final_status: string) => {
      if (finished) return;
      finished = true;
      await Promise.all([
        this.dependencies.table<RelayAttemptRecord>("relay_attempts").update({
          where: { attempt_id: attempt.attempt_id },
          values: { status: final_status, first_output_ms, completed_at: new Date().toISOString(), http_status: 200 },
        }),
        this.finish_request(attempt.request_id, final_status),
        ...(["unknown", "failed"].includes(final_status) ? [this.cooldown(attempt.deployment_id, 15_000)] : []),
      ]).catch(() => {
        // 已产生真实用量后，日志故障不能阻断最终事件和既有可靠结算移交。
        console.error("[Relay] stream log finalization failed", {
          request_id: attempt.request_id, attempt_id: attempt.attempt_id,
        });
      });
    };
    return new ReadableStream<ModelStreamEvent>({
      async pull(controller) {
        try {
          const item = await reader.read();
          if (item.done) {
            await finish(status);
            reader.releaseLock();
            controller.close();
            return;
          }
          const event = item.value;
          if (first_output_ms === null && ["text_delta", "reasoning_delta", "tool_call_start"].includes(event.type)) {
            first_output_ms = Date.now() - started_at;
          }
          if (event.type === "model_error") status = "failed";
          if (event.type === "model_finish" && status !== "failed") {
            status = event.finish_reason === "cancelled" ? "cancelled"
              : ["error", "unknown"].includes(event.finish_reason) ? "unknown" : "succeeded";
          }
          controller.enqueue(event.type === "model_start"
            ? { ...event, request_id: attempt.request_id, model_id: String(ctx.input.model) }
            : event);
        } catch (error) {
          await finish(ctx.request?.signal.aborted ? "cancelled" : "unknown");
          reader.releaseLock();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try { await reader.cancel(reason); } finally {
          await finish("cancelled");
          reader.releaseLock();
        }
      },
    });
  }

  private async finish_request(request_id: string, status: string): Promise<void> {
    await this.dependencies.table<RelayRequestRecord>("relay_requests").update({
      where: { request_id }, values: { status, completed_at: new Date().toISOString() },
    });
  }

  /** 并发失败只延长冷却，不让较早失败覆盖较新的截止时间。 */
  private async cooldown(deployment_id: string, duration_ms: number): Promise<void> {
    const maximum = this.dependencies.database.schema_id === "postgresql" ? "GREATEST" : "MAX";
    await query_service_database(this.dependencies.database, {
      sql: `INSERT INTO service_ai_relay_health (deployment_id, cooldown_until) VALUES (?, ?)
        ON CONFLICT(deployment_id) DO UPDATE SET cooldown_until = ${maximum}(service_ai_relay_health.cooldown_until, excluded.cooldown_until)`,
      params: [deployment_id, Date.now() + Math.min(Math.max(duration_ms, 1000), 300_000)],
    });
  }
}
