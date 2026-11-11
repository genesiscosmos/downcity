/** Skill Power 统一注册：全局资源、MCP 配置、Agent 分配与独立详情视图。 */

import { skill_resource_sidebar, skill_resource_mainview } from "./SkillResources.js";
import { skill_detail_view } from "./SkillDetailView.js";
import { skill_agent_config } from "./SkillAgentConfig.js";
import { mcp_resource_config } from "@/mcp/renderer/McpResources.js";
import { define_power_renderer } from "@downcity/city/power/react";

/** Skill Power Renderer 定义。 */
export const SKILL_POWER_RENDERER = define_power_renderer({
  sidebar: skill_resource_sidebar,
  config: mcp_resource_config,
  agent_config: { id: "skills", label: "Skills", component: skill_agent_config },

  mainview: skill_resource_mainview,
  views: [{ id: "skill_detail", label: "Skill", component: skill_detail_view }],
});
