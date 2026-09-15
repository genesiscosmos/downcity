/**
 * Shell constructor 参数类型。
 *
 * 关键点（中文）
 * - 所有字段都是可选 runtime 调参。
 * - 不传参数时保持 Shell 既有硬编码默认行为。
 * - 这些参数只影响 shell runtime，不改变 sandbox 权限模型。
 */

/**
 * Shell 可选运行参数。
 */
export interface ShellRuntimeOptions {
  /**
   * 最大 in-memory shell session 数量。
   *
   * 超过该数量时，runtime 会优先清理已经结束的旧 session；如果仍然超限则拒绝启动新 shell。
   */
  max_active_shells?: number;

  /**
   * 终态 shell session 在内存中保留多久后自动清理，单位毫秒。
   */
  cleanup_delay_ms?: number;

  /**
   * 单个 shell session 在内存中保留的最大输出字符数。
   *
   * 超出的历史输出仍会写入持久化输出文件，但内存快照只保留尾部内容。
   */
  max_in_memory_output_chars?: number;

  /**
   * shell 输出预览保留的最大字符数。
   */
  output_preview_chars?: number;

  /**
   * wait/timeout 参数允许的最小毫秒数。
   */
  min_wait_ms?: number;

  /**
   * wait/timeout 参数允许的最大毫秒数。
   */
  max_wait_ms?: number;

  /**
   * `shell.start` 默认内联等待时间，单位毫秒。
   */
  default_inline_wait_ms?: number;

  /**
   * `shell.wait` 默认等待超时，单位毫秒。
   */
  default_wait_timeout_ms?: number;

  /**
   * `shell.exec` 默认总超时，单位毫秒。
   */
  default_exec_timeout_ms?: number;
}

/**
 * Shell 归一化后的运行参数。
 */
export interface ResolvedShellRuntimeOptions {
  /**
   * 最大 in-memory shell session 数量。
   */
  max_active_shells: number;

  /**
   * 终态 shell session 在内存中保留多久后自动清理，单位毫秒。
   */
  cleanup_delay_ms: number;

  /**
   * 单个 shell session 在内存中保留的最大输出字符数。
   */
  max_in_memory_output_chars: number;

  /**
   * shell 输出预览保留的最大字符数。
   */
  output_preview_chars: number;

  /**
   * wait/timeout 参数允许的最小毫秒数。
   */
  min_wait_ms: number;

  /**
   * wait/timeout 参数允许的最大毫秒数。
   */
  max_wait_ms: number;

  /**
   * `shell.start` 默认内联等待时间，单位毫秒。
   */
  default_inline_wait_ms: number;

  /**
   * `shell.wait` 默认等待超时，单位毫秒。
   */
  default_wait_timeout_ms: number;

  /**
   * `shell.exec` 默认总超时，单位毫秒。
   */
  default_exec_timeout_ms: number;
}
