/**
 * Workspace 文件监听领域的主进程内部类型。
 *
 * 分两层是为了让绝对路径只存在于主进程：
 *
 * | 类型 | 来自 | 含绝对路径 |
 * |---|---|---|
 * | `WorkspaceFileWatchRequest` | IPC 请求（渲染器提交） | 否 |
 * | `WorkspaceFileWatchTarget` | 主进程解析后 | 是 |
 *
 * 对渲染器可见的变化载荷是 `DesktopWorkspaceFileChangedEvent`（见 common/types），
 * 那里只有 Workspace 标识与相对路径。
 */

/** 渲染器提交的一次监听登记；绝对路径由主进程解析，不由渲染器提供。 */
export interface WorkspaceFileWatchRequest {
  /**
   * 该预览实例的订阅标识，由渲染器生成。
   *
   * 同一窗口里可能同时有两处预览同一个文件（正文与右侧面板），
   * 按它精确释放才能保证其中一处卸载不会掐掉另一处的热更新。
   */
  subscription_id: string;
  /** 订阅方稳定标识；Electron 下是 webContents id，窗口销毁时按它整批释放。 */
  subscriber_id: number;
  /** 文件所属 Workspace。 */
  workspace_id: string;
  /** 订阅时登记的 Workspace 内相对路径；广播时逐字回传，供渲染器精确匹配。 */
  relative_path: string;
  /**
   * 订阅方已经读到的那一版的修改时间戳（毫秒）。
   *
   * 读文件与登记监听是两次 IPC，中间存在一个极短的空窗：若文件恰好在空窗内被改写，
   * 监听基准会取到新版本，订阅方却停在旧内容上，而且不会再收到通知。
   * 带上这个值后，登记时发现它已不是当前版本就立即补一次通知，把空窗收掉。
   */
  known_modified_at: number;
}

/** 主进程解析完成、可以直接建立监听的登记。 */
export interface WorkspaceFileWatchTarget extends WorkspaceFileWatchRequest {
  /** 文件在本机的真实绝对路径；监听与指纹比对都基于它。 */
  absolute_path: string;
}
