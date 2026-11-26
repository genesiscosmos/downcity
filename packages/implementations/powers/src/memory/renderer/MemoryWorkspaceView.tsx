/** Workspace 共享知识管理：使用现有 Page/Field/Select，只选择宿主授权项目。 */
import { useEffect, useState } from "react";
import type { PowerPageComponentProps } from "@downcity/city/power/react";
import type { MemoryManagementScopes } from "../types/MemoryManagement.js";
import { Memory_records_view } from "./MemoryRecordsView.js";

/** 项目切换以真实 Workspace 身份重建内容，草稿不跨项目复用。 */
export function memory_workspace_view({ power, ui }: PowerPageComponentProps) {
  const { Stack, Field, Select, EmptyState, Callout } = ui.components;
  const [scopes, set_scopes] = useState<MemoryManagementScopes>();
  const [workspace_id, set_workspace_id] = useState("");
  const [error, set_error] = useState("");
  useEffect(() => {
    let disposed = false;
    void power.invoke<MemoryManagementScopes>("memory.scopes", {}).then((result) => { if (!disposed) set_scopes(result); })
      .catch((reason) => { if (!disposed) set_error(String(reason)); });
    return () => { disposed = true; };
  }, [power, ui.revision]);
  return <Stack>{error ? <Callout tone="danger">{error}</Callout> : null}
    <Field label="项目"><Select value={workspace_id} options={(scopes?.workspaces ?? []).map(item => ({ value: item.workspace_id, label: item.name }))} on_value_change={set_workspace_id} /></Field>
    {workspace_id ? <Memory_records_view key={workspace_id} power={power} ui={ui} scope="workspace" kind="knowledge" workspace_id={workspace_id} /> : <EmptyState title="选择项目查看共享知识" />}
  </Stack>;
}
