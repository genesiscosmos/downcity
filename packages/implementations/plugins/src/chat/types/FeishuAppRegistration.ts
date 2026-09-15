/**
 * 飞书「扫码一键创建应用」注册会话类型。
 *
 * 关键点（中文）
 * - 这些类型是 Host Action 与 Desktop Renderer 之间的稳定契约。
 * - 注册成功后返回的 App Secret 只在本机 Plugin 进程与当前 Renderer 之间传递，不写入日志和 Activity。
 */

/** 一次扫码注册会话的当前状态。 */
export type FeishuAppRegistrationState =
  /** 已生成二维码，等待用户扫码确认。 */
  | "pending"
  /** 用户已确认，凭据可用。 */
  | "ready"
  /** 平台返回错误。 */
  | "failed"
  /** 二维码超时，需要重新生成。 */
  | "expired"
  /** 用户或系统主动取消。 */
  | "cancelled";

/** Desktop 读取一次扫码注册会话的安全视图。 */
export interface FeishuAppRegistrationView {
  /** 本次注册会话的稳定 ID。 */
  registration_id: string;
  /** 当前会话状态。 */
  state: FeishuAppRegistrationState;
  /** 用户扫码或直接打开的验证链接。 */
  verification_url: string;
  /** 二维码图片 data URL；未就绪时为空字符串。 */
  qr_data_url: string;
  /** 会话过期时间戳，单位毫秒。 */
  expires_at: number;
  /** 失败或取消时用户可见的原因。 */
  error?: string;
  /** 注册成功后新应用的 App ID。 */
  app_id?: string;
  /** 注册成功后新应用的 App Secret。 */
  app_secret?: string;
  /** 注册成功后推导出的 Open API 域名；为空时使用平台默认值。 */
  domain?: string;
}
