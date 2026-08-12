/**
 * Federation 用户公共类型模块。
 *
 * City 直接访问 Federation，Bureau 也可以在完成本地验签后按需读取同一份
 * 用户数据，因此两端共用这些类型。
 */

/** Federation Accounts 当前用户 Profile。 */
export interface UserProfile {
  /** Federation 用户 ID。 */
  user_id: string;

  /** 用户资料邮箱。 */
  email: string;

  /** 用户展示名称。 */
  display_name: string;

  /** 用户头像 URL。 */
  avatar_url: string;

  /** 用户个人简介。 */
  bio: string;

  /** 资料创建时间。 */
  created_at: string;

  /** 资料更新时间。 */
  updated_at: string;
}
