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
  maxActiveShells?: number;

  /**
   * 终态 shell session 在内存中保留多久后自动清理，单位毫秒。
   */
  cleanupDelayMs?: number;

  /**
   * 单个 shell session 在内存中保留的最大输出字符数。
   *
   * 超出的历史输出仍会写入持久化输出文件，但内存快照只保留尾部内容。
   */
  maxInMemoryOutputChars?: number;

  /**
   * shell 输出预览保留的最大字符数。
   */
  outputPreviewChars?: number;

  /**
   * wait/timeout 参数允许的最小毫秒数。
   */
  minWaitMs?: number;

  /**
   * wait/timeout 参数允许的最大毫秒数。
   */
  maxWaitMs?: number;

  /**
   * `shell.start` 默认内联等待时间，单位毫秒。
   */
  defaultInlineWaitMs?: number;

  /**
   * `shell.wait` 默认等待超时，单位毫秒。
   */
  defaultWaitTimeoutMs?: number;

  /**
   * `shell.exec` 默认总超时，单位毫秒。
   */
  defaultExecTimeoutMs?: number;

  /**
   * unrestricted sandbox 审批默认超时时间，单位毫秒。
   */
  defaultApprovalTimeoutMs?: number;
}

/**
 * Shell 归一化后的运行参数。
 */
export interface ResolvedShellRuntimeOptions {
  /**
   * 最大 in-memory shell session 数量。
   */
  maxActiveShells: number;

  /**
   * 终态 shell session 在内存中保留多久后自动清理，单位毫秒。
   */
  cleanupDelayMs: number;

  /**
   * 单个 shell session 在内存中保留的最大输出字符数。
   */
  maxInMemoryOutputChars: number;

  /**
   * shell 输出预览保留的最大字符数。
   */
  outputPreviewChars: number;

  /**
   * wait/timeout 参数允许的最小毫秒数。
   */
  minWaitMs: number;

  /**
   * wait/timeout 参数允许的最大毫秒数。
   */
  maxWaitMs: number;

  /**
   * `shell.start` 默认内联等待时间，单位毫秒。
   */
  defaultInlineWaitMs: number;

  /**
   * `shell.wait` 默认等待超时，单位毫秒。
   */
  defaultWaitTimeoutMs: number;

  /**
   * `shell.exec` 默认总超时，单位毫秒。
   */
  defaultExecTimeoutMs: number;

  /**
   * unrestricted sandbox 审批默认超时时间，单位毫秒。
   */
  defaultApprovalTimeoutMs: number;
}
