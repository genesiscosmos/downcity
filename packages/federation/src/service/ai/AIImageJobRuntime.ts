/**
 * AI 图片异步任务运行时。
 *
 * 本模块唯一负责图片任务的创建、持久化、领取、轮询、超时、结果转存和终态
 * 写入。模型注册与计量结算仍由各自拥有者提供最小能力。
 */

import { httpError } from "../../utils/helpers.js";
import type { AsyncJobRecord } from "../../types/AsyncJob.js";
import type {
  AIImageCreateResult,
  AIImageJobContext,
  AIImageResult,
} from "../../types/AI.js";
import type { AIImageJobRuntimeOptions } from "../../types/AIImageJobRuntime.js";
import type {
  UserImageJobCreateResult,
  UserImageJobResult,
} from "../../pact/user/types.js";
import type { Context } from "../service.js";
import {
  claim_image_job,
  finish_image_job_fetch,
  release_image_job_claim,
} from "./image-job-store.js";
import { AISettlementRuntime } from "./AISettlementRuntime.js";
import {
  imageActionError,
  isImageChannelCreateResult,
  isImageChannelResult,
  isStorableRemoteFilePart,
  normalizePositiveNumber,
  parseImageMessage,
  parseRecordJson,
  readFilePartFilename,
  readFilePartMediaType,
  readOptionalNumber,
  readOptionalString,
  rowToAsyncJobRecord,
} from "./ai-service-values.js";

/** 图片模型在 Registry 内部使用的 Action 模式。 */
export const IMAGE_ACTION_MODES = ["image_create", "image_fetch"] as const;
/** 图片任务后台抓取 Action。 */
export const IMAGE_FETCH_ACTION = "image/fetch";
/** 图片生成任务在通用 async_jobs 表中的类型。 */
const IMAGE_GENERATE_JOB_TYPE = "ai.image.generate";
/** 图片任务默认最长 pending 时间：2 小时。 */
const DEFAULT_IMAGE_MAX_PENDING_DURATION_MS = 2 * 60 * 60 * 1000;
/** 图片任务 pending 超时错误。 */
const IMAGE_PENDING_TIMEOUT_ERROR = "upstream timeout";

/** AI 图片任务状态机。实例生命周期跟随所属 AIService。 */
export class AIImageJobRuntime {
  /** 图片异步任务允许保持 queued/running 的最长时间。 */
  private readonly image_max_pending_duration_ms: number;

  constructor(
    private readonly options: AIImageJobRuntimeOptions,
    private readonly settlement_runtime: AISettlementRuntime,
  ) {
    this.image_max_pending_duration_ms = normalizePositiveNumber(
      options.image_max_pending_duration_ms,
      DEFAULT_IMAGE_MAX_PENDING_DURATION_MS,
    );
  }

  /** 创建上游图片任务、保存本地记录并调度首次抓取。 */
  async create_job(ctx: Context): Promise<UserImageJobCreateResult> {
    const resolved = this.options.resolve_action({
      model: normalize_model_id(ctx.input.model),
      mode: "image_create",
    }, ctx.env);
    this.options.attach_resolved_model(ctx, resolved.model, "image/create");
    const started_at = Date.now();
    this.settlement_runtime.ensure_usage_id(ctx);
    try {
      const created = await resolved.action(ctx);
      if (!isImageChannelCreateResult(created)) {
        throw httpError(500, "image_create action returned invalid result");
      }
      await this.insert_image_job(ctx, created);
      await this.enqueue_image_fetch(ctx, created.job_id, created.poll_after_ms);
      return created;
    } catch (error) {
      await this.settlement_runtime.settle_execution({
        ctx,
        output: undefined,
        outcome: "failed",
        started_at,
      });
      throw imageActionError(error, "image_create action failed");
    }
  }

  /** 读取本地图片任务，不触发上游轮询。 */
  async read_job(ctx: Context): Promise<UserImageJobResult> {
    const job = await this.require_image_job(ctx);
    try {
      return this.image_job_to_result(job);
    } catch (error) {
      throw imageActionError(error, "image_result action failed");
    }
  }

  /** 领取并抓取图片任务状态，根据结果更新 async_jobs。 */
  async fetch_job(ctx: Context): Promise<AIImageResult> {
    let claim: Awaited<ReturnType<typeof claim_image_job>> = null;
    const initial_job = await this.require_image_job(ctx);
    const initial_state = parseRecordJson(initial_job.state_json);
    ctx.locals.ai_usage_id = readOptionalString(initial_state.downcity_usage_id)
      ?? `aiu_image_${initial_job.job_id}`;
    ctx.locals.ai_usage_user_id = initial_job.user_id;
    ctx.locals.ai_usage_bureau_id = initial_job.bureau_id;

    try {
      if (this.is_terminal_image_job(initial_job)) return this.image_job_to_result(initial_job);
      const table = ctx.db.async_jobs;
      if (!table) throw httpError(500, "AI async_jobs table is not initialized");
      claim = await claim_image_job(table, initial_job);
      if (!claim) return this.image_job_to_result(await this.require_image_job(ctx));
      const job = claim.record;
      if (this.is_image_job_pending_timed_out(job)) {
        const output = this.create_image_job_pending_timeout_result(job);
        await this.settlement_runtime.settle_execution({
          ctx,
          output,
          outcome: "failed",
          started_at: Date.parse(job.created_at),
        });
        await finish_image_job_fetch(table, claim, output);
        return output;
      }

      const model_id = job.model_id ?? readOptionalString(ctx.input.model);
      if (!model_id) throw httpError(422, "Image job is missing model_id");
      const model = this.options.resolve_model(model_id);
      if (!model?.runtime.actions.image_fetch) {
        throw httpError(422, `No image_fetch action for model: ${model_id}`);
      }

      this.options.attach_resolved_model(ctx, model, IMAGE_FETCH_ACTION);
      this.attach_image_job_context(ctx, job);
      const started_at = Date.now();
      const output = await model.runtime.actions.image_fetch(ctx);
      if (!isImageChannelResult(output)) {
        throw httpError(500, "image_fetch action returned invalid result");
      }
      const stored_output = await this.normalize_image_result_storage(ctx, output);
      const should_charge = output.status === "succeeded" && Boolean(output.result) && !job.result_json;
      if (should_charge) {
        this.settlement_runtime.attach_output_metering(ctx, stored_output.result, "image", started_at);
        const charge = Promise.resolve(model.bill?.(
          this.settlement_runtime.build_bill_input(ctx, model, stored_output),
        )).then((line) => line
          ? { ...line, user_id: line.user_id ?? job.user_id ?? undefined }
          : undefined);
        await this.settlement_runtime.settle_execution({
          ctx,
          output: stored_output,
          outcome: "succeeded",
          started_at: Date.parse(job.created_at),
          charge,
        });
      } else if (stored_output.status === "failed") {
        await this.settlement_runtime.settle_execution({
          ctx,
          output: stored_output,
          outcome: "failed",
          started_at: Date.parse(job.created_at),
        });
      }
      await finish_image_job_fetch(table, claim, stored_output);
      if (stored_output.status === "queued" || stored_output.status === "running") {
        await this.enqueue_image_fetch(ctx, job.job_id, stored_output.poll_after_ms);
      }
      return stored_output;
    } catch (error) {
      const table = ctx.db.async_jobs;
      if (table && claim) await release_image_job_claim(table, claim);
      throw imageActionError(error, "image_fetch action failed");
    }
  }

  /** 判断图片任务是否已经进入本地终态。 */
  private is_terminal_image_job(job: AsyncJobRecord): boolean {
    return Boolean((job.status === "succeeded" && job.result_json) || job.status === "failed");
  }

  /** 判断图片任务是否超过平台允许的 pending 时间。 */
  private is_image_job_pending_timed_out(job: AsyncJobRecord): boolean {
    if (job.status !== "queued" && job.status !== "running" && job.status !== "fetching") return false;
    const created_at = Date.parse(job.created_at);
    if (!Number.isFinite(created_at)) return false;
    return Date.now() - created_at >= this.image_max_pending_duration_ms;
  }

  /** 构造 pending 超时后的统一失败结果。 */
  private create_image_job_pending_timeout_result(job: AsyncJobRecord): AIImageResult {
    return {
      job_id: job.job_id,
      status: "failed",
      message: IMAGE_PENDING_TIMEOUT_ERROR,
      error: IMAGE_PENDING_TIMEOUT_ERROR,
      metadata: {
        ...this.read_image_job_state(job),
        timeout_reason: IMAGE_PENDING_TIMEOUT_ERROR,
        max_pending_duration_ms: this.image_max_pending_duration_ms,
      },
    };
  }

  /** 调度下一次图片任务抓取。 */
  private async enqueue_image_fetch(ctx: Context, job_id: string, delay_ms?: number): Promise<void> {
    if (!ctx.queue) return;
    await ctx.queue.send({
      service: "ai",
      action: IMAGE_FETCH_ACTION,
      input: { job_id },
      delay_ms,
    });
  }

  /** 将图片结果里的外部文件 URL 归一到 Federation 默认存储。 */
  private async normalize_image_result_storage(
    ctx: Context,
    output: AIImageResult,
  ): Promise<AIImageResult> {
    if (!ctx.storage || output.status !== "succeeded" || !output.result) return output;
    const result = output.result as { parts?: unknown[] };
    if (!Array.isArray(result.parts)) return output;

    let changed = false;
    const next_parts: unknown[] = [];
    for (const part of result.parts) {
      if (!isStorableRemoteFilePart(part)) {
        next_parts.push(part);
        continue;
      }

      const source_url = part.url;
      if (ctx.storage.owns(source_url)) {
        next_parts.push(part);
        continue;
      }

      try {
        const stored = await ctx.storage.store({
          source_url,
          media_type: readFilePartMediaType(part),
          filename: readFilePartFilename(part),
        });
        const stored_url = readOptionalString(stored.url);
        if (!stored_url) {
          next_parts.push(part);
          continue;
        }
        next_parts.push({
          ...part,
          url: stored_url,
        });
        changed = true;
      } catch (error) {
        console.warn(
          `[AIService] storage store failed, keeping source url :: ${error instanceof Error ? error.message : String(error)} :: url=${source_url}`,
        );
        next_parts.push(part);
      }
    }

    if (!changed) return output;
    return {
      ...output,
      result: {
        ...output.result,
        parts: next_parts as typeof output.result.parts,
      },
    };
  }

  /** 写入新建的图片任务。 */
  private async insert_image_job(ctx: Context, created: AIImageCreateResult): Promise<void> {
    const table = ctx.db.async_jobs;
    if (!table) throw httpError(500, "AI async_jobs table is not initialized");
    const now = new Date().toISOString();
    await table.insert({
      job_id: created.job_id,
      job_type: IMAGE_GENERATE_JOB_TYPE,
      status: created.status,
      input_json: JSON.stringify(ctx.input ?? {}),
      state_json: JSON.stringify({
        ...(created.metadata ?? {}),
        downcity_usage_id: this.settlement_runtime.ensure_usage_id(ctx),
      }),
      result_json: null,
      error: created.error ?? null,
      message: created.message ?? null,
      poll_after_ms: created.poll_after_ms ? String(created.poll_after_ms) : null,
      bureau_id: ctx.bureau?.bureau_id ?? null,
      user_id: ctx.user?.user_id ?? null,
      service_id: "ai",
      model_id: ctx.metering?.model_id ?? null,
      created_at: now,
      updated_at: now,
    });
  }

  /** 读取并校验当前请求指定的图片任务。 */
  private async require_image_job(ctx: Context): Promise<AsyncJobRecord> {
    const table = ctx.db.async_jobs;
    if (!table) throw httpError(500, "AI async_jobs table is not initialized");
    const job_id = readOptionalString(ctx.input.job_id);
    if (!job_id) throw httpError(422, "job_id is required");
    const rows = await table.select({ job_id, job_type: IMAGE_GENERATE_JOB_TYPE });
    const row = rows[0];
    if (!row) throw httpError(404, `Image job not found: ${job_id}`);
    return rowToAsyncJobRecord(row);
  }

  /** 把 async_jobs 记录注入 AIChannel 可读取的上下文。 */
  private attach_image_job_context(ctx: Context, job: AsyncJobRecord): void {
    const image_job: AIImageJobContext = {
      record: job,
      input: parseRecordJson(job.input_json),
      state: this.read_image_job_state(job),
    };
    ctx.locals.ai_image_job = image_job;
    ctx.input = {
      ...parseRecordJson(job.input_json),
      ...ctx.input,
      job_id: job.job_id,
    };
  }

  /** 将 async_jobs 记录转换成稳定的图片任务结果。 */
  private image_job_to_result(job: AsyncJobRecord): AIImageResult {
    return {
      job_id: job.job_id,
      status: job.status === "fetching" ? "running" : job.status,
      result: job.status === "succeeded" ? parseImageMessage(job.result_json) : undefined,
      error: job.error ?? undefined,
      message: job.message ?? undefined,
      poll_after_ms: readOptionalNumber(job.poll_after_ms),
      metadata: this.read_image_job_state(job),
    };
  }

  /** 读取不会向 Provider 或客户端泄漏内部 usage_id 的任务状态。 */
  private read_image_job_state(job: AsyncJobRecord): Record<string, unknown> {
    const state = parseRecordJson(job.state_json);
    const { downcity_usage_id: _usage_id, ...public_state } = state;
    return public_state;
  }
}

/** 将未知模型输入归一为可选稳定 ID。 */
function normalize_model_id(input: unknown): string | undefined {
  const model_id = typeof input === "string" ? input.trim() : "";
  return model_id || undefined;
}
