/**
 * Desktop/CLI 共用的 Town 图片任务来源仓储。
 * 只保存非秘密路由事实，不保存 Token；每次 put 在单个 SQLite 事务内提交，
 * 已有句柄的来源不可更改，unknown 记录不能作为新的 pending 请求重放。
 */
import type { TownImageJobOrigin, TownImageJobStore } from "../../town/types/TownImageJobs.js";
import type { LocalDatabase } from "../database/LocalDatabase.js";
import { LocalSettingRepository } from "./LocalSettingRepository.js";

/** 基于宿主 platform_settings 的持久来源映射，无额外数据库连接或 Timer。 */
export class TownImageJobRepository implements TownImageJobStore {
  private readonly settings: LocalSettingRepository;

  constructor(private readonly database: LocalDatabase) {
    this.settings = new LocalSettingRepository(database);
  }

  /** 只读取 Town 本地任务句柄，不接受裸远端 ID 反推来源。 */
  async get(job_id: string): Promise<TownImageJobOrigin | undefined> {
    return this.settings.get<TownImageJobOrigin>(this.key(job_id)) ?? undefined;
  }

  /** pending 后仅补齐同一来源的原任务 ID；状态改变不会重写历史主体。 */
  async put(origin: TownImageJobOrigin): Promise<void> {
    const key = this.key(origin.job_id);
    if (!origin.connection_id || !origin.auth_scope_id || !origin.endpoint_url || !origin.model_id
      || !["pending", "submitted", "unknown"].includes(origin.state)
      || !Number.isFinite(Date.parse(origin.created_at))
      || (origin.state === "submitted" && !origin.original_job_id)) throw new TypeError("Invalid Town image job origin");
    this.database.transaction(() => {
      const previous = this.settings.get<TownImageJobOrigin>(key);
      if (previous && (previous.connection_id !== origin.connection_id || previous.auth_scope_id !== origin.auth_scope_id
        || previous.endpoint_url !== origin.endpoint_url || previous.model_id !== origin.model_id
        || previous.created_at !== origin.created_at
        || (previous.original_job_id !== undefined && previous.original_job_id !== origin.original_job_id)
        || (previous.state !== "pending" && previous.state !== origin.state))) {
        throw new Error("Town image job origin cannot be replaced or replayed");
      }
      this.settings.set(key, origin);
    });
  }

  /** ID 仅用于设置表索引，不参与文件路径或 SQL 拼接。 */
  private key(job_id: string): string {
    if (typeof job_id !== "string" || !/^town_image_[a-f\d-]{36}$/u.test(job_id)) throw new TypeError("Town image job handle required");
    return `town.image-job:${job_id}`;
  }
}
