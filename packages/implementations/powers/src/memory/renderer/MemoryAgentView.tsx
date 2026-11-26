/** Agent 专属约定与知识共用按条管理；复用宿主 Page、Tabs 与详情组件。 */
import { useState } from "react";
import type { PowerAgentConfigComponentProps } from "@downcity/city/power/react";
import { Memory_records_view } from "./MemoryRecordsView.js";
import { MemoryJobs } from "./MemoryJobs.js";
export function memory_agent_view(props: PowerAgentConfigComponentProps) {
  return <Memory_agent_content key={props.agent_id} {...props} />;
}
function Memory_agent_content({ agent_id, power, ui }: PowerAgentConfigComponentProps) {
  const { Page, Tabs } = ui.components;
  const [section, set_section] = useState("agreement");
  return <Page><Tabs value={section} label="Agent 记忆" variant="segmented" items={[
    { value: "agreement", label: "持续约定" }, { value: "knowledge", label: "知识" }, { value: "jobs", label: "处理记录" },
  ]} on_value_change={set_section} />
    <div hidden={section !== "agreement"}><Memory_records_view power={power} ui={ui} scope="agent" agent_id={agent_id} kind="agreement" /></div>
    <div hidden={section !== "knowledge"}><Memory_records_view power={power} ui={ui} scope="agent" agent_id={agent_id} kind="knowledge" /></div>
    {section === "jobs" ? <MemoryJobs power={power} ui={ui} scope="agent" agent_id={agent_id} embedded /> : null}
  </Page>;
}
