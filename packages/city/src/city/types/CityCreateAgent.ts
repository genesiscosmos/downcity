/**
 * 模型侧创建持久 Agent 的宿主协议。
 * 身份目录、模型装配与失败回滚由宿主负责，Power 只接收完成注册的主体。
 */
import type { Agent } from "@downcity/agent";

/** 创建一个持久 Agent 所需的业务配置。 */
export interface CityCreateAgentInput {
  /** 用户可见名称；稳定 Agent ID 由宿主生成并校验唯一性。 */
  name: string;
  /** 对外职责简介，供 agent.list 发现和选择协作对象。 */
  description: string;
  /** 主体行为指令，保存为该 Agent 的持久化指令。 */
  instruction: string;
  /** 默认模型的稳定标识，由宿主校验并装配。 */
  model_id: string;
}

/** 宿主完成持久化、注册和必要的初始化后返回；失败须回滚。 */
export type CityCreateAgent = (input: CityCreateAgentInput) => Promise<Agent>;
