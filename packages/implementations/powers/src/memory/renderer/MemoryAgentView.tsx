/** Agent 私有记忆入口：持续约定只读展示，知识列表与独立详情沿用既有操作。 */

import { useEffect, useState } from "react";
import type { PowerAgentConfigComponentProps } from "@downcity/city/power/react";
import type { ProfileDocument } from "@/memory/types/Profile.js";
import { Memory_knowledge_content } from "./MemoryKnowledgeView.js";

/** 宿主切换 Agent 时重新建立私有范围，子分区切换保留已访问内容。 */
export function memory_agent_view(props: PowerAgentConfigComponentProps) {
  return <Memory_agent_content key={props.agent_id} {...props} />;
}

/** 默认读取当前 Agent 的持续约定，知识首次访问后保留草稿和列表状态。 */
function Memory_agent_content({ agent_id, power, ui }: PowerAgentConfigComponentProps) {
  const { Page, Stack, Tabs } = ui.components;
  const [section, set_section] = useState("profile");
  const [knowledge_visited, set_knowledge_visited] = useState(false);
  return <Page>
    <Tabs value={section} label="Agent 私有记忆" variant="segmented" items={[
      { value: "profile", label: "持续约定" },
      { value: "knowledge", label: "知识" },
    ]} on_value_change={(value) => {
      set_section(value);
      if (value === "knowledge") set_knowledge_visited(true);
    }} />
    <div hidden={section !== "profile"}>
      <Stack><Agent_profile_content agent_id={agent_id} power={power} ui={ui} /></Stack>
    </div>
    {knowledge_visited ? <div hidden={section !== "knowledge"}>
      <Stack><Memory_knowledge_content power={power} ui={ui} notifications={[]} navigation={{ route: { scope: "agent", agent_id }, navigate: () => undefined }} /></Stack>
    </div> : null}
  </Page>;
}

/** 读取完整 Agent Profile；不混入 User Profile、Workspace 知识或任何编辑入口。 */
function Agent_profile_content({ agent_id, power, ui }: PowerAgentConfigComponentProps) {
  const { Button, Callout, EmptyState, LoadingState, Markdown, Toolbar } = ui.components;
  const [profile, set_profile] = useState<ProfileDocument>();
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState("");
  const [read_revision, set_read_revision] = useState(0);
  useEffect(() => {
    let disposed = false;
    set_loading(true);
    set_error("");
    void power.invoke<ProfileDocument>("memory.profile_read", { target: "agent", agent_id })
      .then((value) => { if (!disposed) set_profile(value); })
      .catch((reason) => { if (!disposed) set_error(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!disposed) set_loading(false); });
    return () => { disposed = true; };
  }, [agent_id, power, read_revision, ui.revision]);
  // 来源标记只用于内部幂等管理，阅读界面只展示约定正文。
  const content = profile?.content.replace(/<!-- memory-source:[a-f0-9]+(?::[a-f0-9]+)? -->\n?/gu, "").trim() ?? "";
  return <>
    <Toolbar actions={<Button disabled={loading} on_click={() => set_read_revision((value) => value + 1)}>{loading ? "读取中…" : error ? "重试" : "刷新"}</Button>} />
    {error ? <Callout tone="danger">{error}</Callout> : null}
    {profile ? content ? <Markdown text={content} /> : <EmptyState title="还没有持续约定" size="compact" />
      : loading ? <LoadingState label="正在读取持续约定…" /> : null}
  </>;
}
