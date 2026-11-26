/** Session 管理的统一公开契约；宿主 Power 与脚本桥接共用参数、结果及说明。 */
import { z } from "zod";

/** 单条会话的可序列化目录事实，不包含消息、配置或执行器。 */
export const session_metadata_schema = z.object({
  /** 会话永久 UUID。 */
  id: z.string(),
  /** 会话的持久化分类。 */
  type: z.string(),
  /** 创建者声明的业务用途。 */
  kind: z.string(),
  /** 用户可见标题；未命名时省略。 */
  title: z.string().optional(),
  /** 会话绑定的 Workspace；无项目时省略。 */
  workspace_id: z.string().optional(),
  /** 首次创建时间，毫秒时间戳。 */
  created_at: z.number().optional(),
  /** 最近会话活动时间，毫秒时间戳。 */
  updated_at: z.number().optional(),
  /** 是否有正在执行的工作。 */
  executing: z.boolean().optional(),
  /** 是否已归档。 */
  archived: z.boolean(),
});

/** 目录查询始终沿用完整条件翻页；时间条件由调用者按元数据显式选择。 */
export const session_list_input = z.object({
  /** 持久化分类，默认 work。 */
  type: z.string().default("work"),
  /** 按业务用途过滤。 */
  kind: z.string().optional(),
  /** 仅查询指定 Workspace 的会话。 */
  workspace_id: z.string().optional(),
  /** 标题、标识或预览关键词。 */
  query: z.string().optional(),
  /** 上页返回的游标，必须配合同一组条件使用。 */
  cursor: z.string().optional(),
  /** 单页条数，最多 100。 */
  limit: z.number().int().min(1).max(100).default(30),
}).strict();

/** 会话管理地址；归档重试沿用永久 UUID。 */
export const session_address_schema = z.object({
  /** 目标会话永久 UUID。 */
  session_id: z.string().min(1),
  /** 持久化分类，默认 work。 */
  type: z.string().default("work"),
}).strict();

/** 归档会话及其后代；部分失败后沿用返回错误中的恢复标识。 */
export const session_archive_input = session_address_schema.extend({
  /** 原归档操作 UUID；首次调用时省略。 */
  operation_id: z.uuid().optional(),
  /** 原归档根 UUID；恢复原操作时提供。 */
  root_session_id: z.uuid().optional(),
});

/** 重命名的统一标题校验。 */
export const session_title_input = z.object({
  /** 新标题，去掉首尾空白后为 1 到 500 个字符。 */
  title: z.string().trim().min(1).max(500),
}).strict();

/** 归档服务的结果，保留部分失败恢复与幂等执行所需事实。 */
export const session_archive_result = z.object({
  /** archived 表示原计划完成；incomplete 表示必须沿用恢复标识处理剩余节点。 */
  status: z.enum(["archived", "incomplete"]),
  /** 部分失败时的可读说明；原计划标识一并返回，避免跨脚本丢失恢复能力。 */
  error: z.string().optional(),
  /** 被归档的根会话永久 UUID。 */
  session_id: z.string(),
  /** 持久化归档操作 UUID。 */
  operation_id: z.string().optional(),
  /** 原归档根的永久 UUID。 */
  root_session_id: z.string().optional(),
  /** 原持久化子树计划的摘要。 */
  plan_fingerprint: z.string().optional(),
  /** 本次根节点实际归档时间，毫秒时间戳。 */
  archived_at: z.number().optional(),
  /** 本次调用是否实际移动了节点。 */
  changed: z.boolean().optional(),
});

/** 元数据页；调用者必须沿用原过滤条件传递游标。 */
export const session_page_schema = z.object({
  /** 当前页元数据。 */
  items: z.array(session_metadata_schema),
  /** 过滤后的总条数。 */
  total: z.number(),
  /** 下一页游标；末页省略。 */
  next_cursor: z.string().optional(),
  /** 是否还有下一页。 */
  has_more: z.boolean(),
});

/** 已校验的单条元数据类型，字段说明以统一 schema 为准。 */
export type PowerSessionMetadata = z.infer<typeof session_metadata_schema>;
/** 查询参数类型，字段说明以统一 schema 为准。 */
export type PowerSessionListInput = z.input<typeof session_list_input>;
/** 管理地址类型，字段说明以统一 schema 为准。 */
export type PowerSessionAddress = z.input<typeof session_address_schema>;
/** 归档参数类型，字段说明以统一 schema 为准。 */
export type PowerSessionArchiveInput = z.input<typeof session_archive_input>;
/** 归档结果类型，字段说明以统一 schema 为准。 */
export type PowerSessionArchiveResult = z.infer<typeof session_archive_result>;
/** 元数据分页类型，字段说明以统一 schema 为准。 */
export type PowerSessionPage = z.infer<typeof session_page_schema>;
