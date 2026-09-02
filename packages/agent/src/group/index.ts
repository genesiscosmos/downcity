/** Group 主体公开入口。 */
export { Group } from "./Group.js";
export { GroupSession } from "./GroupSession.js";
export { GroupSessions } from "./GroupSessions.js";
export { AiDispatchStrategy } from "@/types/group/DispatchStrategy.js";
export type {
  DispatchAssignment,
  DispatchDecision,
  DispatchGroupProfile,
  DispatchMemberProfile,
  DispatchStage,
  DispatchTrigger,
  DispatchStrategy,
  AiDispatchStrategyOptions,
} from "@/types/group/DispatchStrategy.js";
export type { GroupContract, GroupMessage, GroupOptions } from "@/types/group/Group.js";
export type {
  GroupMemberRuntime,
  GroupEvent,
  GroupStatusPhase,
  GroupEventSubscriber,
  GroupEventUnsubscribe,
  GroupPromptInput,
  GroupPromptResult,
  GroupSessionContract,
  GroupSessionCreateInput,
  GroupSessionGetInput,
  GroupSessionListInput,
  GroupSessionSummary,
  GroupSessions as GroupSessionsContract,
} from "@/types/group/GroupSession.js";
