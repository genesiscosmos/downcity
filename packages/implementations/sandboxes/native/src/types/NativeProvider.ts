/**
 * Native Sandbox Provider 公开配置类型。
 *
 * 这些参数只描述隔离环境的基础行为，不暴露平台细节，避免 Downcity 的公开 API
 * 与单一实现绑定。
 */

/** 宿主授权的 SSH 身份使用能力；不传递私钥。 */
export interface NativeSshAccess {
  /** 宿主指定的现存 Unix socket 绝对路径；命令提供的 SSH_AUTH_SOCK 不参与选择。 */
  socket_path: string;
  /** 宿主维护的专用 known_hosts 普通文件绝对路径，只读开放；未知主机拒绝连接。 */
  known_hosts_path: string;
}

/** Native Sandbox Provider 构造参数。 */
export interface NativeProviderOptions {
  /** 隔离环境出网策略；省略时由 Workspace 绑定决定，默认允许。 */
  network?: "allow" | "deny";
  /** 显式授权 SSH 密钥管家和主机信任文件；省略时不注入 SSH 能力。 */
  ssh?: NativeSshAccess;
  /** 宿主明确允许传给命令的凭证变量名称，大小写精确匹配；默认全部移除。Downcity 内部令牌始终移除。 */
  allowed_credential_env?: readonly string[];
}
