/** City 远程连接及可访问 Agent 的公开协议。 */

/** City 的远程连接配置。 */
export interface RemoteCityOptions {
  /** City 根 HTTP/HTTPS 地址，允许反向代理路径前缀。 */
  readonly url: string;
  /** 宿主认可的访问凭据；权限范围由服务端决定。 */
  readonly token?: string;
}

/** 通过当前凭据可访问的 Agent 身份，不包含指令或私有配置。 */
export interface RemoteCityAgentInfo {
  /** Agent 稳定标识。 */
  readonly id: string;
  /** 个人化姓名。 */
  readonly name: string;
  /** 可选身份与角色列表；无角色时省略，不包含行为指令。 */
  readonly role?: string[];
  /** 对外能力说明。 */
  readonly description: string;
}
