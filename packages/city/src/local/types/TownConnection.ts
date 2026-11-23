/** Town 本地连接、账户及宿主凭据契约；公开资料与私密凭据分离。 */

/** 一条持久化服务连接的非秘密资料。 */
export interface TownConnection {
  /** 宿主分配的稳定连接 ID；不随名称、地址或账户变化。 */
  connection_id: string;
  /** 用户可改的服务展示名称，不参与执行路由。 */
  name: string;
  /** 当前规范化 HTTP(S) endpoint，不能携带凭据、query 或 fragment。 */
  url: string;
  /** active 可恢复登记，removed 保留历史但禁止自动连接。 */
  status: "active" | "removed";
  /** 此连接持久化修改代次，用于宿主 CAS，不替代运行时执行门禁。 */
  revision: number;
  /** 当前选中的本地账户标识，未选择身份时省略。 */
  account_id?: string;
  /** 当前已选择身份的非秘密授权来源，未核验主体时省略。 */
  auth_scope_id?: string;
  /** remote 由宿主管理登录，extension 的授权和生命周期归扩展。 */
  source: "remote" | "extension";
  /** 首次建立连接时间，UTC ISO 字符串。 */
  created_at: string;
  /** 最后一次持久修改时间，UTC ISO 字符串。 */
  updated_at: string;
}

/** 账户列表投影，不得包含登录 Token 或刷新凭据。 */
export interface TownAccount {
  /** 本地账户 ID；主体由连接、原 endpoint 与 user_id 共同界定。 */
  account_id: string;
  /** 所属稳定连接 ID。 */
  connection_id: string;
  /** 此账户认证时的 endpoint，地址变更后禁止把凭据转发到新地址。 */
  url: string;
  /** 远端用户 ID；仅迁移待核验账户允许为空字符串。 */
  user_id: string;
  /** 经核验主体对应的稳定非秘密来源；未知主体不得自动补出。 */
  auth_scope_id?: string;
  /** 用户可见昵称，不作为身份依据。 */
  display_name?: string;
  /** 远端提供的邮箱资料，不用于跨服务合并账户。 */
  email?: string;
  /** 远端提供的头像地址。 */
  avatar_url?: string;
  /** UserSessionRepository 中可续期设备会话的非秘密标识。 */
  session_id?: string;
  /** 最近显式选择账户时间，毫秒时间戳。 */
  last_used_at: number;
  /** 当前连接是否明确选中此账户。 */
  selected: boolean;
}

/** 身份核验成功后由宿主提交的账户资料；不可传给 renderer。 */
export interface TownAccountInput {
  /** accounts/me 返回且已核验的远端主体 ID，必须非空。 */
  user_id: string;
  /** 新会话的私密用户凭据，仅保存于宿主账户仓储。 */
  user_token: string;
  /** 已由 UserSessionRepository 保存的设备会话标识。 */
  session_id?: string;
  /** 宿主通过 prepare_account_scope 取得的非秘密来源；同主体复用，首次登录可预分配后原子提交。 */
  auth_scope_id?: string;
  /** 远端可选昵称。 */
  display_name?: string;
  /** 远端可选邮箱。 */
  email?: string;
  /** 远端可选头像地址。 */
  avatar_url?: string;
}

/** 宿主专用凭据视图，不得写日志或经 IPC 返回给 UI。 */
export interface TownCredentials {
  /** 所属稳定连接。 */
  connection_id: string;
  /** 所属本地账户。 */
  account_id: string;
  /** 经核验主体对应的非秘密授权来源。 */
  auth_scope_id?: string;
  /** 凭据唯一允许访问的原 endpoint。 */
  url: string;
  /** 已核验远端主体；迁移待核验身份可能为空。 */
  user_id: string;
  /** 静态用户凭据；动态续期应通过 session_id 查共享仓储。 */
  user_token: string;
  /** 可续期设备会话标识。 */
  session_id?: string;
}

/** 仓储私有账户事实；仅从安全的宿主入口读取凭据。 */
export interface StoredTownAccount extends Omit<TownAccount, "selected"> {
  /** 此账户最后交付的私密用户 Token，退出后清除。 */
  user_token?: string;
}

/** platform_settings 内的版本化连接事实源。 */
export interface TownConnectionState {
  /** 当前存储格式版本，显式迁移后只写此结构。 */
  version: 1;
  /** 包含已移除连接的稳定 ID 索引。 */
  connections: Record<string, TownConnection>;
  /** 各连接的已保存历史账户，退出不删除资料。 */
  accounts: Record<string, StoredTownAccount>;
}

/** 新增远端连接的公开参数。 */
export interface TownConnectionInput {
  /** 明确要连接的 HTTP(S) endpoint，不能继承其他连接的 Token。 */
  url: string;
  /** 可选服务名，省略时使用规范 endpoint。 */
  name?: string;
}

/** 列出连接时的过滤参数。 */
export interface TownConnectionListOptions {
  /** true 时包含保留历史的停用条目，默认只返回 active。 */
  include_removed?: boolean;
}

/** 迁移函数所需的既有配置访问能力，不依赖 Town 运行时。 */
export interface TownMigrationSettings {
  /** 从宿主设置表读取原始值，不输出到日志。 */
  get<T>(key: string): T | null;
  /** 把完整原值写入私密迁移档案或当前事实源。 */
  set(key: string, value: unknown): void;
}
