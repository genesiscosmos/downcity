/**
 * City 测试运行环境。
 *
 * 该适配器只创建真实 Workspace，并记录装配调用；不引入模型、Plugin、Sandbox 或
 * Federation，便于测试 City 自身的所有权与失败语义。
 */

import fs from "node:fs/promises";
import { Workspace } from "../../agent/bin/index.js";

/** 创建 City 可以装配的最小 Agent 配置。 */
export function create_agent_config(agent_id, workspace_path) {
  return {
    agent_id,
    version: "1.0.0",
    workspace: {
      workspace_id: `workspace_${agent_id}`,
      workspace_path,
      name: agent_id,
    },
    plugins: [],
  };
}

/** 仅供 City 单元测试使用的平台环境。 */
export class TestCityEnvironment {
  created_agent_ids = [];
  disposed = false;

  /** 将测试配置装配成纯运行时 Agent 参数。 */
  async create_agent_options(config) {
    await fs.mkdir(config.workspace.workspace_path, { recursive: true });
    this.created_agent_ids.push(config.agent_id);
    return {
      id: config.agent_id,
      workspace: new Workspace({ path: config.workspace.workspace_path }),
    };
  }

  /** 记录 Environment 最终释放。 */
  async dispose() {
    this.disposed = true;
  }
}
