/** 用户记忆主页面：只呈现跨 Agent 的持续约定与知识，不引入 Agent 或项目选择。 */
import { useState } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import { memory_user_profile as MemoryUserProfile } from "./MemoryUserProfile.js";
import { memory_user_knowledge as MemoryUserKnowledge } from "./MemoryUserKnowledge.js";

/** 已访问页签保持挂载，切换时保留未提交编辑。 */
export function memory_user_view(props: PowerMainviewComponentProps) {
  const { Page, Stack, Tabs } = props.ui.components;
  const [section, set_section] = useState("profile");
  const [knowledge_visited, set_knowledge_visited] = useState(false);
  return <Page>
    <Tabs value={section} label="用户记忆" variant="segmented" items={[
      { value: "profile", label: "持续约定" }, { value: "knowledge", label: "知识" },
    ]} on_value_change={(value) => { set_section(value); if (value === "knowledge") set_knowledge_visited(true); }} />
    <div hidden={section !== "profile"}><Stack><MemoryUserProfile {...props} /></Stack></div>
    {knowledge_visited ? <div hidden={section !== "knowledge"}><Stack><MemoryUserKnowledge {...props} /></Stack></div> : null}
  </Page>;
}
