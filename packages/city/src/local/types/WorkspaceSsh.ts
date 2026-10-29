/**
 * 本地 Workspace SSH 授权记录及管理输入。
 *
 * 记录归宿主所有，不放入项目文件，不保存私钥或 token。
 * 同一授权供 Workspace 内全部 Agent 使用，socket 失效后需要重新授权。
 */

/** 已保存的 SSH 密钥管家授权。 */
export interface LocalWorkspaceSshAuthorization {
  /** 授权时解析得到的 Unix socket 真实绝对路径，不跟随之后的符号链接变更。 */
  socket_path: string;
  /** 授权时 socket 的设备标识，用于检测同一路径上端点被替换。 */
  socket_device: string;
  /** 授权时 socket 的 inode 标识；代理重启后要求重新授权。 */
  socket_inode: string;
  /** 宿主独占管理的 known_hosts 绝对路径，不允许项目进程写入。 */
  known_hosts_path: string;
  /** 授权确认时间，ISO 8601 字符串。 */
  authorized_at: string;
}

/** 宿主检查的 Workspace SSH 当前状态。 */
export interface LocalWorkspaceSshStatus {
  /** 未授权、可使用或授权端点失效；不触发 SSH 登录或网络访问。 */
  state: "disabled" | "ready" | "needs_authorization";
  /** 已保存的授权；未授权时为 null，不包含秘密材料。 */
  authorization: LocalWorkspaceSshAuthorization | null;
  /** 人可读状态原因；不输出密钥内容。 */
  reason: string;
}

/** 用户确认的 SSH 授权输入。 */
export interface LocalWorkspaceSshInput {
  /** 用户明确选择的现有 Unix socket 绝对路径。 */
  socket_path: string;
  /** 用户独立核验并导入的 known_hosts 条目；此接口不自动信任网络扫描结果。 */
  known_hosts: string;
}
