/**
 * Downcity 官方 Feedback 服务实现。
 *
 * 设计边界：
 * - 用户反馈按 Bureau 产品作用域记录
 * - 服务只负责落库、查询、答复与状态更新，不做通知推送
 * - official edge-worker 只需要显式注册本服务，不需要实现私有反馈逻辑
 */

import {
  InstallableService,
  httpError,
  type CityTableApi,
  type ServiceInstallContext,
} from "@downcity/city";
import { register_feedback_routes } from "./routes.js";
import { feedbackMessages } from "./schema.js";
import type {
  FeedbackCreateInput,
  FeedbackCreateResult,
  FeedbackMessage,
  FeedbackQueryInput,
  FeedbackReplyInput,
  FeedbackReplyResult,
  FeedbackStatusUpdateInput,
  FeedbackStatusUpdateResult,
} from "./types.js";
import {
  normalizeFeedbackStatus,
  normalizeLimit,
  normalizeOptionalFeedbackStatus,
  normalizeOptionalFilter,
  read_bureau_id,
  read_optional_bureau_id_filter,
  parseFeedbackMessage,
  randomFeedbackId,
  readFeedbackId,
  readOptionalText,
  readRequiredText,
  sortAndLimitFeedback,
  stringifyFeedbackMeta,
} from "./utils.js";

/**
 * Feedback 服务实例。
 */
export class FeedbackService extends InstallableService {
  readonly id = "feedback";
  readonly name = "Feedback";
  readonly version = "0.1.0";
  readonly schema = {
    messages: feedbackMessages,
  };

  private messages_table?: CityTableApi<FeedbackMessage>;

  constructor() {
    super();
    this.instruction = [
      "允许已登录用户提交产品反馈、问题报告和建议。",
      "管理员可查询反馈、写入官方答复，并更新 open / reviewing / replied / closed 状态。",
      "用户可查看自己在当前 Bureau 提交过的反馈和官方答复。",
      "反馈默认只保存在 Downcity 数据库，不会自动发送到邮件、Slack 或其它外部渠道。",
    ].join("\n");
  }

  install(ctx: ServiceInstallContext): void {
    this.messages_table = ctx.table<FeedbackMessage>("messages");
    register_feedback_routes(this, ctx);
  }

  /**
   * 创建用户反馈。
   */
  async create(user_id: string, bureau_id: string, input: FeedbackCreateInput): Promise<FeedbackCreateResult> {
    const message = readRequiredText(input.message, "message", 10_000);
    const contact = readOptionalText(input.contact, "contact", 500);
    const now = new Date().toISOString();
    const item: FeedbackMessage = {
      feedback_id: randomFeedbackId(),
      bureau_id: read_bureau_id(bureau_id),
      user_id: readRequiredText(user_id, "user_id", 500),
      message,
      contact,
      status: "open",
      reply: "",
      reply_by: "",
      replied_at: "",
      metadata_json: stringifyFeedbackMeta(input.meta),
      created_at: now,
      updated_at: now,
    };

    await this.messages().insert(item);

    return {
      feedback_id: item.feedback_id,
      status: item.status,
      created_at: item.created_at,
    };
  }

  /**
   * 管理员查询反馈。
   */
  async listMessages(input: FeedbackQueryInput): Promise<FeedbackMessage[]> {
    const bureau_id = read_optional_bureau_id_filter(input.bureau_id);
    const user_id = normalizeOptionalFilter(input.user_id, "user_id");
    const status = normalizeOptionalFeedbackStatus(input.status);
    const limit = normalizeLimit(input.limit, 100, 500);
    const where: Partial<FeedbackMessage> = {};

    if (bureau_id) where.bureau_id = bureau_id;
    if (user_id) where.user_id = user_id;
    if (status) where.status = status;

    return sortAndLimitFeedback(await this.messages().select(where), limit);
  }

  /**
   * 查询当前用户在当前 Bureau 下提交的反馈。
   */
  async listUserMessages(user_id: string, bureau_id: string, input: FeedbackQueryInput): Promise<FeedbackMessage[]> {
    const status = normalizeOptionalFeedbackStatus(input.status);
    const limit = normalizeLimit(input.limit, 100, 200);
    const where: Partial<FeedbackMessage> = {
      user_id: readRequiredText(user_id, "user_id", 500),
      bureau_id: read_bureau_id(bureau_id),
    };

    if (status) where.status = status;

    return sortAndLimitFeedback(await this.messages().select(where), limit);
  }

  /**
   * 写入管理员答复。
   */
  async reply(input: FeedbackReplyInput): Promise<FeedbackReplyResult> {
    const feedback_id = readFeedbackId(input.feedback_id);
    const reply = readRequiredText(input.reply, "reply", 10_000);
    const reply_by = readOptionalText(input.reply_by, "reply_by", 200, "admin") || "admin";
    await this.readRequired(feedback_id);

    const replied_at = new Date().toISOString();
    await this.messages().update({
      where: { feedback_id },
      values: {
        reply,
        reply_by,
        replied_at,
        status: "replied",
        updated_at: replied_at,
      },
    });

    return {
      feedback_id,
      status: "replied",
      replied_at,
    };
  }

  /**
   * 更新反馈处理状态。
   */
  async updateStatus(input: FeedbackStatusUpdateInput): Promise<FeedbackStatusUpdateResult> {
    const feedback_id = readFeedbackId(input.feedback_id);
    const status = normalizeFeedbackStatus(input.status);
    await this.readRequired(feedback_id);

    const updated_at = new Date().toISOString();
    await this.messages().update({
      where: { feedback_id },
      values: {
        status,
        updated_at,
      },
    });

    return {
      feedback_id,
      status,
      updated_at,
    };
  }

  /**
   * 读取反馈，缺失时返回 404。
   */
  private async readRequired(feedback_id: string): Promise<FeedbackMessage> {
    const rows = await this.messages().select({ feedback_id });
    const row = rows[0];
    if (!row) throw httpError(404, "feedback not found");
    return parseFeedbackMessage(row);
  }

  /**
   * 读取反馈消息表。
   */
  private messages(): CityTableApi<FeedbackMessage> {
    if (!this.messages_table) throw new Error("FeedbackService messages table is not ready");
    return this.messages_table;
  }
}
