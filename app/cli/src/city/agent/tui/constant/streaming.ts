/**
 * 流式渲染节流参数。
 *
 * 关键点（中文）
 * - 高频 text-delta 直接 requestRender 会让终端反复整行重绘，
 *   通过 50ms 合并多次变更，肉眼仍连续但 CPU/IO 显著降低。
 */

/**
 * 两次实际刷新之间的最小间隔（毫秒）。
 */
export const STREAMING_UI_FLUSH_MS = 50;
