/**
 * Downcity Downtown 连接状态类型。
 *
 * 关键点（中文）
 * - `city` CLI 作为本机 City 容器，必须加入某个 Downtown 才能访问共享资源。
 * - 本文件描述 City 可选的 Downtown 配置与当前成员资格状态。
 * - City 容器只读取 Downtown 管理端已保存 Session 的存在性，不接触管理员密码。
 */

/**
 * City 可选择的 Downtown 配置摘要。
 */
export interface DowntownProfile {
  /**
   * Downtown 展示名称。
   *
   * 说明（中文）
   * - 可能来自 Downcity 本地配置、默认 Downtown，或 Downtown 管理端保存的列表。
   * - 若未显式设置，通常回退为 URL hostname。
   */
  name: string;

  /**
   * Downtown 服务地址。
   *
   * 说明（中文）
   * - 已做基础规范化，末尾不带多余 `/`。
   * - City runtime 会通过该地址访问 Downtown 的用户态服务。
   */
  downtown_url: string;

  /**
   * 是否是当前 City 选择的 Downtown。
   */
  selected: boolean;

  /**
   * Downtown 来源。
   */
  source: "downcity-profile" | "downtown-admin" | "default";

  /**
   * 该 Downtown 是否由 `downtown` CLI 保存了有效管理员会话。
   *
   * 说明（中文）
   * - 这里只展示存在性，不暴露 Session Token。
   * - 管理员会话到期后该值自动为 false。
   */
  has_admin_session: boolean;

  /**
   * 该 Downtown 是否已有 Downtown User Session。
   *
   * 说明（中文）
   * - 用户 Session 由 Downtown 登录流程维护，不从 Downtown Admin 配置导入。
   */
  has_user_session: boolean;


  /**
   * Downtown User Session 中的 Downtown User ID。
   *
   * 说明（中文）
   * - 只用于状态展示，不参与权限判断。
   */
  user_id?: string;
}

/**
 * City 当前 Downtown 成员资格状态。
 */
export interface DowntownMembershipState {
  /**
   * 当前 City 选择的 Downtown 地址。
   */
  downtown_url: string;


  /**
   * 是否已保存 user token。
   *
   * 说明（中文）
   * - 只展示存在性，不输出 token 明文。
   * - Agent runtime 缺少 User Token 时无法调用 Downtown 用户态服务。
   */
  has_user_token: boolean;

  /**
   * 连接来源。
   *
   * 说明（中文）
   * - `downtown-session` 表示 Downcity 已在当前 Downtown 登录用户。
   * - `downcity-profile` 表示已选择 Downtown，但尚未登录用户。
   * - `downtown-admin` 表示当前 Downtown 来自 `fed` 管理配置。
   * - `default` 表示使用默认 Downtown。
   * - `missing` 表示没有可用成员资格。
   */
  source: "downtown-session" | "downcity-profile" | "downtown-admin" | "default" | "missing";

  /**
   * 当前登录用户 ID。
   */
  user_id?: string;

  /**
   * 当前登录用户展示名称。
   */
  user_label?: string;
}
