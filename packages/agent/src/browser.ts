/** 浏览器可用的 Agent 共享协议入口，不导入本地 Agent、存储或 Node 模块。 */
export { describe_prompt_powers, snapshot_prompt_powers, execute_prompt_power } from "./power/PromptPowerExecution.js";
export { is_agent_session_prompt_input_empty } from "./types/sdk/AgentSessionPrompt.js";
export type { PromptPower, PromptPowerAction, PromptPowerCallContext } from "@downcity/type";
