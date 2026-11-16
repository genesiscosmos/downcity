/** Session 详情读取的窄依赖；只聚合存储元数据和当前执行投影。 */
import type { ModelClient } from "@downcity/type";
import type { SessionStorage } from "../store/SessionStorage.js";

/** 读取当前详情所需的唯一事实来源，不复制运行状态。 */
export interface SessionInformationInput {
  /** 已初始化会话的持久化视图，负责元数据读取和错误传播。 */
  store: SessionStorage;
  /** 当前所属 Agent，作为返回详情的授权路由事实。 */
  agent_id: string;
  /** 当前会话永久 UUID，不由标题或 Agent ID 派生。 */
  session_id: string;
  /** 当前 Workspace 路径，仅用于详情投影，不用于定位持久化记录。 */
  project_root: string;
  /** 当前模型实例，只用于在存储未提供标签时读取显示名称。 */
  model?: ModelClient;
  /** 调用瞬间的执行状态，不作为另一处持久化事实源。 */
  executing: boolean;
}
