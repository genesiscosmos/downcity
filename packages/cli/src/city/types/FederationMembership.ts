/**
 * Downcity Federation 连接状态类型。
 *
 * 关键点（中文）
 * - `city` CLI 作为本机 City 容器，必须加入某个 Federation 才能访问共享资源。
 * - 本文件描述 City 可选的 Federation 配置与当前成员资格状态。
 * - City 容器只读取 Federation 管理端已保存 Session 的存在性，不接触管理员密码。
 */

/**
 * City 可选择的 Federation 配置摘要。
 */
export interface FederationProfile {
  /**
   * Federation 展示名称。
   *
   * 说明（中文）
   * - 可能来自 Downcity 本地配置、默认 Federation，或 Federation 管理端保存的列表。
   * - 若未显式设置，通常回退为 URL hostname。
   */
  name: string;

  /**
   * Federation 服务地址。
   *
   * 说明（中文）
   * - 已做基础规范化，末尾不带多余 `/`。
   * - City runtime 会通过该地址访问 Federation 的用户态服务。
   */
  federation_url: string;

  /**
   * 是否是当前 City 选择的 Federation。
   */
  selected: boolean;

  /**
   * Federation 来源。
   */
  source: "downcity-profile" | "federation-admin" | "default";

  /**
   * 该 Federation 是否由 `downfed` CLI 保存了有效管理员会话。
   *
   * 说明（中文）
   * - 这里只展示存在性，不暴露 Session Token。
   * - 管理员会话到期后该值自动为 false。
   */
  has_admin_session: boolean;

  /**
   * 该 Federation 是否已有 Embassy User Session。
   *
   * 说明（中文）
   * - 用户 Session 由 Embassy 登录流程维护，不从 Federation Admin 配置导入。
   */
  has_user_session: boolean;

  /**
   * Embassy User Session 中绑定的 bureau_id。
   *
   * 说明（中文）
   * - 为空表示未登录或 session 文件不可用。
   */
  bureau_id?: string;

  /**
   * Embassy User Session 中的 Federation User ID。
   *
   * 说明（中文）
   * - 只用于状态展示，不参与权限判断。
   */
  user_id?: string;
}

/**
 * City 当前 Federation 成员资格状态。
 */
export interface FederationMembershipState {
  /**
   * 当前 City 选择的 Federation 地址。
   */
  federation_url: string;

  /**
   * 当前 Embassy User Session 使用的 bureau_id。
   */
  bureau_id: string;

  /**
   * 是否已保存 user token。
   *
   * 说明（中文）
   * - 只展示存在性，不输出 token 明文。
   * - Agent runtime 缺少 User Token 时无法调用 Federation 用户态服务。
   */
  has_user_token: boolean;

  /**
   * 连接来源。
   *
   * 说明（中文）
   * - `embassy-session` 表示 Downcity 已在当前 Federation 登录用户。
   * - `downcity-profile` 表示已选择 Federation，但尚未登录用户。
   * - `federation-admin` 表示当前 Federation 来自 `fed` 管理配置。
   * - `default` 表示使用默认 Federation。
   * - `missing` 表示没有可用成员资格。
   */
  source: "embassy-session" | "downcity-profile" | "federation-admin" | "default" | "missing";

  /**
   * 当前登录用户 ID。
   */
  user_id?: string;

  /**
   * 当前登录用户展示名称。
   */
  user_label?: string;
}
