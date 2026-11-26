/** 逻辑对象资源 tab，按真实 scope 与 ID 打开统一详情。 */
import type { PowerViewComponentProps } from "@downcity/city/power/react";
import { Memory_records_view } from "./MemoryRecordsView.js";
export function memory_detail_view({ input, power, ui }: PowerViewComponentProps) {
  const scope = input.scope === "user" || input.scope === "workspace" ? input.scope : "agent";
  return <Memory_records_view key={JSON.stringify(input)} power={power} ui={ui} scope={scope}
    kind={input.kind === "agreement" ? "agreement" : "knowledge"}
    agent_id={typeof input.agent_id === "string" ? input.agent_id : undefined}
    workspace_id={typeof input.workspace_id === "string" ? input.workspace_id : undefined}
    initial_memory_id={typeof input.memory_id === "string" ? input.memory_id : undefined} />;
}
