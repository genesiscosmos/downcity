/**
 * 通用异步任务类型模块。
 *
 * City 内部所有需要跨请求恢复、轮询或后台执行的任务都使用这组结构。
 * 具体业务能力通过 job_type 区分，例如图片生成使用 `ai.image.generate`。
 */

/** 通用异步任务状态。 */
export type AsyncJobStatus = "queued" | "running" | "fetching" | "succeeded" | "failed";

/**
 * 通用异步任务表行。
 */
export interface AsyncJobRecord {
  /** City 内部生成的异步任务 ID。 */
  job_id: string;
  /** 任务类型，例如 `ai.image.generate`。 */
  job_type: string;
  /** 当前任务状态。 */
  status: AsyncJobStatus;
  /** 创建任务时的原始输入，JSON 字符串。 */
  input_json: string;
  /** 任务推进时需要保留的中间状态，JSON 字符串。 */
  state_json?: string | null;
  /** 成功后的业务结果，JSON 字符串。 */
  result_json?: string | null;
  /** 失败时给客户端展示的错误消息。 */
  error?: string | null;
  /** 当前任务状态说明，便于客户端展示或排障。 */
  message?: string | null;
  /** 建议下一次轮询或后台抓取的间隔毫秒数。 */
  poll_after_ms?: string | null;
  /** 当前 User Token 绑定的 Bureau ID。 */
  bureau_id?: string | null;
  /** 当前终端用户 ID。 */
  user_id?: string | null;
  /** 创建该任务的 Service ID。 */
  service_id?: string | null;
  /** 本次任务解析到的模型 ID。 */
  model_id?: string | null;
  /** 创建时间。 */
  created_at: string;
  /** 更新时间。 */
  updated_at: string;
}
