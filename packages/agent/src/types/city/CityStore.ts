/**
 * City 持久化适配器协议。
 *
 * Store 负责把持久化配置恢复为可直接使用的 Agent，并保存 City 新注册的 Agent。
 * 数据库记录、序列化结构和运行时装配方式均属于具体 Store 的内部实现。
 */

import type { Agent } from "@/agent/Agent.js";

/** City 使用的持久化适配器。 */
export interface CityStore {
  /** 从持久化配置恢复全部 Agent；返回值的生命周期转移给 City。 */
  load_agents(): Promise<readonly Agent[]>;

  /** 持久化一个可恢复的 Agent；不接管该实例的生命周期。 */
  save_agent(agent: Agent): Promise<void>;

  /** 删除指定 Agent 的持久化注册，不删除 Workspace 或 Session 数据。 */
  remove_agent(agent_id: string): Promise<void>;

  /** 释放 Store 自己持有的连接等资源。 */
  dispose(): Promise<void>;
}
