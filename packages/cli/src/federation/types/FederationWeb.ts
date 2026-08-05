/**
 * Federation 本地 Web 控制面类型。
 *
 * 这些类型只描述 `fed web` 进程拥有的本地 HTTP 边界，不属于 Federation
 * Server 的公开协议。
 */

/** 启动 Federation 本地 Web UI 的命令参数。 */
export interface FederationWebOptions {
  /** 本地 HTTP Server 监听地址；当前只允许 loopback。 */
  host: string;
  /** 本地 HTTP Server 监听端口，传入 0 时由操作系统分配。 */
  port: number;
  /** 启动成功后是否尝试打开系统默认浏览器。 */
  open: boolean;
  /** 可选的 Federation 本地名称或 URL；未提供时使用 active Federation。 */
  federation?: string;
}

/** 已解析的 Federation Web UI 运行上下文。 */
export interface FederationWebContext {
  /** Federation 在本地配置中的展示名称。 */
  federation_name: string;
  /** Federation Server 基础 URL。 */
  federation_url: string;
  /** 仅保存在本地 BFF 进程中的 Root Admin 凭证。 */
  admin_secret_key: string;
}

/** 本地 Web Server 启动后的绑定信息。 */
export interface FederationWebBinding {
  /** 浏览器访问本地控制面的完整 URL。 */
  url: string;
  /** 关闭 HTTP Server 并释放监听端口。 */
  close: () => Promise<void>;
}

/** 浏览器提交给本地控制面的受限管理动作。 */
export interface FederationWebActionRequest {
  /** 动作 ID；本地 BFF 只接受显式登记的动作。 */
  action: string;
  /** 动作输入；由每个动作独立校验。 */
  payload?: Record<string, unknown>;
}
