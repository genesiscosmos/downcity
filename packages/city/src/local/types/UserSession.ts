/** 本地设备登录凭证和跨进程刷新租约。 */
import type { UserSessionCredentials } from "@downcity/federation";

/** 单条本地会话；每个 session_id 只有一个事实源。 */
export interface StoredUserSession extends UserSessionCredentials {
  /** 精确绑定的 Federation 地址，禁止向其他地址发送凭证。 */
  federation_url: string;
  /** 已明确失效或本机已退出，旧运行时不能恢复此记录。 */
  invalidated?: boolean;
  /** 已持久化的刷新请求 ID；网络失败重试沿用。 */
  refresh_id?: string;
  /** 当前执行刷新请求的进程随机租约。 */
  lease_owner?: string;
  /** 租约到期时间，Unix 毫秒；进程崩溃后可接管。 */
  lease_until?: number;
}
