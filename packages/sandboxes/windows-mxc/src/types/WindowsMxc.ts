/** Microsoft MXC Windows adapter 类型。 */

/** MXC 当前可能选择的 Windows 进程隔离层级。 */
export type WindowsMxcIsolationTier =
  | "base-container"
  | "appcontainer-bfs"
  | "appcontainer-dacl";

/** Windows MXC Development 后端宿主探测结果。 */
export interface WindowsMxcSupport {
  /** 当前宿主是否满足 Downcity Windows Development 支持条件。 */
  supported: boolean;
  /** 当前 Windows build number；无法识别时为空。 */
  windows_build: number | null;
  /** MXC runtime 实际选择的隔离层级；probe 失败时为空。 */
  isolation_tier?: WindowsMxcIsolationTier;
  /** MXC probe 返回的降级或宿主准备警告。 */
  warnings: string[];
  /** 不支持时面向用户的稳定原因。 */
  reason?: string;
}
