/**
 * Accounts 持久化内部类型。
 *
 * 这些类型只描述 AccountsStore 的写入边界，不属于 package 对外 API。
 */

/** 写入或更新用户 Profile 的标准输入。 */
export interface AccountsProfileWriteInput {
  /** better-auth 用户稳定 ID。 */
  user_id: string;
  /** 用户规范化邮箱。 */
  email: string;
  /** 用户展示名称。 */
  display_name: string;
  /** 用户头像 URL；没有头像时为空字符串。 */
  avatar_url: string;
}
