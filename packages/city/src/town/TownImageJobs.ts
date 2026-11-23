/**
 * Town 图片任务来源仓储与路由。
 *
 * 创建前先保存 pending 来源，远端返回后再保存原始 job ID；请求已发出但结果不明时
 * 标记 unknown，禁止再次创建。默认仓储只在当前进程有效，宿主通过 TownOptions.image_jobs
 * 注入持久实现；查询始终使用原连接、原 endpoint 与原 auth_scope_id。
 */
import type { ModelReference } from "@downcity/type";
import { randomUUID } from "node:crypto";
import type { AIImageResult, UserImageInput } from "@downcity/downtown";
import { TownError } from "./ExecutionLease.js";
import type { TownConnectionState, TownConnections } from "./TownConnections.js";
import type { TownImageJobOrigin, TownImageJobStore } from "./types/TownImageJobs.js";
import type { TownOptions } from "./types/Town.js";

/** 当前进程默认任务仓储，不声称可跨重启恢复。 */
class MemoryTownImageJobStore implements TownImageJobStore {
  private readonly records = new Map<string, TownImageJobOrigin>();

  async get(job_id: string): Promise<TownImageJobOrigin | undefined> {
    const record = this.records.get(job_id);
    return record ? { ...record } : undefined;
  }

  async put(origin: TownImageJobOrigin): Promise<void> {
    this.records.set(origin.job_id, { ...origin });
  }
}

/** 图片任务的统一创建、来源固定查询和未知结果处理。 */
export class TownImageJobs {
  private readonly store: TownImageJobStore;
  private readonly resolve_image_user: TownOptions["resolve_image_user"];

  constructor(
    private readonly connections: TownConnections,
    options: TownOptions,
  ) {
    this.store = options.image_jobs ?? new MemoryTownImageJobStore();
    this.resolve_image_user = options.resolve_image_user;
  }

  /** 创建前写入来源，返回 Town 本地句柄；调用者不能拿原始 job ID 重新创建。 */
  async create(
    state: TownConnectionState,
    model: ModelReference,
    input: UserImageInput,
    signal?: AbortSignal,
  ): Promise<AIImageResult> {
    signal?.throwIfAborted();
    const job_id = `town_image_${randomUUID()}`;
    const origin: TownImageJobOrigin = {
      job_id,
      downtown_id: state.source.downtown_id,
      auth_scope_id: state.source.auth_scope_id,
      endpoint_url: state.source.endpoint_url,
      model,
      state: "pending",
      created_at: new Date().toISOString(),
    };
    await this.store.put(origin);
    let response: AIImageResult;
    try {
      this.connections.assert_current(state);
      signal?.throwIfAborted();
      const result = await state.user.service("ai").request("image/create", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, client_job_id: job_id }), signal,
      });
      response = await result.json() as AIImageResult;
    } catch (error) {
      await this.store.put({ ...origin, state: "unknown" });
      throw error;
    }
    const original_job_id = read_job_id(response);
    if (!original_job_id) {
      await this.store.put({ ...origin, state: "unknown" });
      throw new TownError("town_image_job_id_missing");
    }
    await this.store.put({ ...origin, original_job_id, state: "submitted" });
    return { ...response, job_id };
  }

  /** 查询使用来源记录恢复原授权；禁止使用当前页面选择的模型或账户。 */
  async result(job_id: string, signal?: AbortSignal): Promise<AIImageResult> {
    const origin = await this.store.get(job_id);
    if (!origin) throw new TownError("town_image_job_not_found");
    if (origin.state === "pending") throw new TownError("town_image_job_pending");
    if (origin.state === "unknown") throw new TownError("town_image_result_unknown");
    if (!origin.original_job_id) throw new TownError("town_image_job_id_missing");
    signal?.throwIfAborted();

    const current = this.connections.require(origin.downtown_id);
    // 改地址后不能调用原身份恢复器访问其他 endpoint；先恢复原连接再查询。
    if (current.source.endpoint_url !== origin.endpoint_url) throw new TownError("town_image_original_endpoint_required");
    const release = this.connections.acquire(current);
    try {
      let response: AIImageResult;
      if (current.source.auth_scope_id !== origin.auth_scope_id) {
        if (!this.resolve_image_user) throw new TownError("town_image_original_identity_required");
        const user = await this.resolve_image_user(origin, signal);
        signal?.throwIfAborted();
        response = await user.ai.image_result({ job_id: origin.original_job_id });
      } else {
        const result = await current.user.service("ai").request("image/result", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ job_id: origin.original_job_id }), signal,
        });
        response = await result.json() as AIImageResult;
      }
      signal?.throwIfAborted();
      this.connections.assert_current(current);
      return { ...response, job_id };
    } finally { release(); }
  }
}

function read_job_id(response: AIImageResult): string | undefined {
  const job_id = typeof response?.job_id === "string" ? response.job_id.trim() : "";
  return job_id || undefined;
}
