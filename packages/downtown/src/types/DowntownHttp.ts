/** Downtown HTTP 服务端策略：限额统计字节，期限单位为毫秒，不接受请求参数抬高限制。 */

/** 单类请求的有界读取与前台执行策略。 */
export interface DowntownHttpLimits {
  /** 实际读取正文的最大字节数；无 Content-Length 同样受限。 */
  max_body_bytes: number;
  /** 正文读取总期限，不因接收到新的 chunk 而延期。 */
  body_timeout_ms: number;
  /** 正文读取完成后等待响应的期限；SSE 启动后仅保留取消与整体硬期限。 */
  execution_timeout_ms: number;
}

/** 服务端按路径明确覆盖默认分类；精确路径优先于默认类别。 */
export interface DowntownHttpRoutePolicy extends Partial<DowntownHttpLimits> {
  /** 绝对 HTTP 路径，只做精确匹配，不能为前缀或通配。 */
  path: string;
}

/** Downtown 构造时的可选策略；所有未配置字段采用安全默认值。 */
export interface DowntownHttpPolicy {
  /** 普通 API，默认 1 MiB / 15 秒读取 / 30 秒执行。 */
  ordinary?: Partial<DowntownHttpLimits>;
  /** Webhook，默认 2 MiB / 15 秒读取 / 30 秒执行。 */
  webhook?: Partial<DowntownHttpLimits>;
  /** 媒体与同步 AI，默认 40 MiB / 60 秒读取 / 180 秒执行。 */
  media?: Partial<DowntownHttpLimits>;
  /** 模型流启动，默认 40 MiB / 60 秒读取 / 180 秒等待响应头；不等于首有效输出期限。 */
  model_stream?: Partial<DowntownHttpLimits>;
  /** SSE 响应从正文读取完成起的整体硬上限，默认 15 分钟；不定义事件空闲时间。 */
  stream_lifetime_ms?: number;
  /** 显式路径覆盖；同一路径重复或未知字段会在构造期拒绝。 */
  routes?: DowntownHttpRoutePolicy[];
}
