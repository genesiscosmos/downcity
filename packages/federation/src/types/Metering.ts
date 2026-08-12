/**
 * 运行时计量类型。
 *
 * 关键说明（中文）
 * - Service action 可以把真实用量写到 Context.metering
 * - usage / billing / balance hook 后续统一读取这份计量事实
 * - 字段保持通用，避免只绑定某一个 provider 的 usage 结构
 */

/**
 * 单次调用的标准化计量信息。
 */
export interface RuntimeMetering {
  /**
   * 计量所属 AIChannel ID，例如 `deepseek`、`openai-image`。
   */
  channel_id?: string;

  /**
   * Downcity 模型 ID。
   */
  model_id?: string;

  /**
   * 上游 provider 实际模型 ID。
   */
  upstream_model?: string;

  /**
   * 输入 token 数。
   */
  input_tokens?: number;

  /**
   * 输出 token 数。
   */
  output_tokens?: number;

  /**
   * cached input token 数。
   */
  cached_tokens?: number;

  /**
   * 模型输出中的推理 token 数。
   */
  reasoning_tokens?: number;

  /**
   * 图片数量。
   */
  image_count?: number;

  /**
   * 视频秒数。
   */
  video_seconds?: number;

  /**
   * 音频秒数。
   */
  audio_seconds?: number;

  /**
   * 请求固定计费数量，通常为 1。
   */
  request_count?: number;

  /**
   * 调用耗时毫秒。
   */
  duration_ms?: number;

  /**
   * provider 原始 usage 对象。
   */
  raw_usage?: unknown;

  /**
   * 额外结构化信息。
   */
  metadata?: Record<string, unknown>;
}
