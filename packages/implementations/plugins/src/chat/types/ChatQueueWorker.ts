/**
 * ChatQueueWorker 类型定义。
 *
 * 关键点（中文）
 * - 这里集中声明 chat queue worker 相关的共享配置类型。
 * - 运行态实现细节仍在 service/runtime 中，跨模块共享的契约提升到 `src/types/`。
 */

/**
 * ChatQueueWorker 的运行配置。
 */
export type ChatQueueWorkerConfig = {
  /**
   * 最大并发 lane 数。
   */
  max_concurrency: number;
  /**
   * burst merge 防抖窗口（毫秒）。
   */
  merge_debounce_ms: number;
  /**
   * burst merge 最长等待时间（毫秒）。
   */
  merge_max_wait_ms: number;
};
