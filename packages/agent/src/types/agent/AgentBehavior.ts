/** Agent 可替换的行为配置；宿主身份、Workspace、存储和执行端口不属于行为。 */
import type { AgentOptions } from "./AgentOptions.js";

/** 完整行为快照，替换仅允许在 Agent 全部会话空闲时进行。 */
export type AgentBehavior = Pick<AgentOptions, "instruction" | "model" | "tools" | "hooks" | "session_class" | "session_composer">;
