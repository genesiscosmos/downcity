/** Task 实例配置与应用回调；任务变化与启动 Action 返回是独立事实。 */
import type { TaskAnalyzer } from "./TaskPreparation.js";

/**
 * TaskPowerOptions：TaskPower 构造参数。
 *
 * 关键点（中文）
 * - TaskPower 本身就是定时任务 runtime，不提供 enabled 开关。
 * - 只暴露用户能直接理解的时区配置，内部调度实现细节不进入 constructor。
 */

/**
 * TaskPower 构造参数。
 */
export interface TaskPowerOptions {
  /** 定义提交或执行状态改变后调用；无历史重放，异步回调不阻塞任务。 */
  readonly on_changed?: () => void | Promise<void>;
  /**
   * cron task 使用的 IANA 时区。
   *
   * 说明（中文）
   * - 例如 `Asia/Shanghai`、`America/Los_Angeles`。
   * - 省略时使用当前运行机器的本机时区。
   * - `time:<ISO8601-with-timezone>` 一次性任务以 ISO 字符串自身的 offset 为准，这里的时区主要影响 cron 表达式。
   */
  timezone?: string;
  /** 宿主注入的模型分析端口，不依赖 Desktop；缺失时任务仍可记录。 */
  analyze_task?: TaskAnalyzer;

}
