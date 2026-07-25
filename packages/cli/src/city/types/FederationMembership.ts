/**
 * City 与 Federation 成员资格状态类型。
 *
 * 关键点（中文）
 * - `city` CLI 作为本机 City 容器，必须加入某个 Federation 才能访问共享资源。
 * - 本文件描述 City 可选的 Federation 配置与当前成员资格状态。
 * - City 不读取 Federation admin 密钥或 user token 的明文，只使用 City 自身保存的 session。
 */

/**
 * City 可选择的 Federation 配置摘要。
 */
export interface FederationProfile {
  /**
   * Federation 展示名称。
   *
   * 说明（中文）
   * - 可能来自 City 本地配置、默认 base，或 `city` CLI 的 admin base 列表。
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
  source: "city" | "city-admin" | "default";

  /**
   * 该 Federation 是否由 `downfed` CLI 保存了 admin secret key。
   *
   * 说明（中文）
   * - 这里只展示存在性，不暴露密钥明文。
   * - City 不依赖 admin 密钥管理 Federation 资源。
   */
  has_admin_secret_key: boolean;

  /**
   * 该 Federation 是否已有 City user session。
   *
   * 说明（中文）
   * - user session 由 City 自身维护，不从 `downfed` admin 配置导入。
   */
  has_user_session: boolean;

  /**
   * City user session 中绑定的 city_id。
   *
   * 说明（中文）
   * - 为空表示未登录或 session 文件不可用。
   */
  city_id?: string;

  /**
   * City user session 中的用户 ID。
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
   * 当前 City user session 使用的 city_id。
   */
  city_id: string;

  /**
   * 是否已保存 user token。
   *
   * 说明（中文）
   * - 只展示存在性，不输出 token 明文。
   * - Agent runtime 缺少 user token 时无法调用 City 用户态服务。
   */
  has_user_token: boolean;

  /**
   * 连接来源。
   *
   * 说明（中文）
   * - `city-session` 表示 City 已在当前 Federation 登录 user。
   * - `city-base` 表示 City 已选择 Federation，但尚未登录 user。
   * - `city-admin` 表示当前 Federation 来自 `downfed` admin 配置候选。
   * - `default` 表示使用默认 Federation。
   * - `missing` 表示没有可用成员资格。
   */
  source: "city-session" | "city-base" | "city-admin" | "default" | "missing";

  /**
   * 当前登录用户 ID。
   */
  user_id?: string;

  /**
   * 当前登录用户展示名称。
   */
  user_label?: string;
}
