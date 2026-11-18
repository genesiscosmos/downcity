/** 应用 bootstrap 只返回服务端选中的 Session 定位；消息与执行使用官方 SDK 协议。 */
export interface ChatBootstrap {
  /** 服务端持有的单用户 Session 标识。 */ session_id: string;
  /** 创建与恢复时保持一致的来源分类。 */ category: string;
  /** 同源 Agent/Workspace 官方 transport 根路径。 */ agent_url: string;
}
