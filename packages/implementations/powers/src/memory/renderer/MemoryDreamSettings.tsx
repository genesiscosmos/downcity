/** Builtin 页的后台整理配置：概览已启用范围，仅在新增时选择 Agent，项目选项按需展开。 */
import { useEffect, useState } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { MemoryDreamScope } from "../types/MemoryDream.js";
import type { MemoryDreamSummary, MemoryManagementScopes } from "../types/MemoryManagement.js";

/** 后台整理不承担知识编辑或运行诊断，只提供明确的启用与关闭。 */
export function memory_dream_settings({ power, ui }: Pick<PowerMainviewComponentProps, "power" | "ui">) {
  const { Button, Callout, Field, Group, Inline, LoadingState, Row, Section, Select, Status } = ui.components;
  const [items, set_items] = useState<MemoryDreamSummary[]>();
  const [scopes, set_scopes] = useState<MemoryManagementScopes>();
  const [error, set_error] = useState("");
  const [adding, set_adding] = useState(false);
  const [advanced, set_advanced] = useState(false);
  const [agent_id, set_agent_id] = useState("");
  const [workspace_id, set_workspace_id] = useState("");
  const [share, set_share] = useState(false);
  const [busy, set_busy] = useState(false);
  const [revision, set_revision] = useState(0);
  useEffect(() => {
    let disposed = false;
    set_error("");
    void Promise.all([
      power.invoke<{ items: MemoryDreamSummary[] }>("memory.dream.list"),
      power.invoke<MemoryManagementScopes>("memory.scopes"),
    ]).then(([result, directory]) => {
      if (!disposed) { set_items(result.items); set_scopes(directory); }
    }).catch((reason) => { if (!disposed) set_error(error_message(reason)); });
    return () => { disposed = true; };
  }, [power, ui.revision, revision]);

  /** 配置请求只提交用户选中的范围，关闭保留既有输入和处理记录。 */
  const configure = async (scope: MemoryDreamScope, enabled: boolean) => {
    set_busy(true); set_error("");
    try {
      await power.invoke("memory.dream.configure", { ...scope, enabled });
      if (enabled) { set_adding(false); set_agent_id(""); set_workspace_id(""); set_share(false); set_advanced(false); }
      set_revision((value) => value + 1);
      ui.toast({ type: "success", message: enabled ? "已启用后台整理" : "已关闭后台整理" });
    } catch (reason) { set_error(error_message(reason)); }
    finally { set_busy(false); }
  };
  const selected_workspace = advanced ? workspace_id : "";
  const selected_scope: MemoryDreamScope = { agent_id,
    ...(selected_workspace ? { workspace_id: selected_workspace } : {}),
    target: selected_workspace && share ? "current_workspace" : "agent" };
  const duplicate = items?.some((item) => item.scope.agent_id === agent_id
    && item.scope.workspace_id === selected_scope.workspace_id && item.scope.target === selected_scope.target);
  return <Section title="后台整理" description="自动整理明确纠错与已验收结果，没有新材料时不调用模型。">
    {error ? <Callout tone="danger">{error}</Callout> : null}
    {!items && !error ? <LoadingState label="正在读取后台整理配置…" /> : null}
    {items ? <>
      <Group>
        {!items.length ? <Row label="未启用" description="选择 Agent 后启用，默认整理无项目范围的材料，结果仅该 Agent 可见。" /> : items.map((item) => {
          const scope = item.scope;
          const agent_name = scopes?.agents.find((agent) => agent.agent_id === scope.agent_id)?.name ?? scope.agent_id;
          const workspace_name = scopes?.workspaces.find((workspace) => workspace.workspace_id === scope.workspace_id)?.name ?? scope.workspace_id;
          const label = scope.target === "current_workspace" ? `${agent_name} · ${workspace_name} · 项目共享`
            : `${agent_name} · ${workspace_name || "无项目"} · 私有`;
          return <Row key={`${scope.agent_id}:${scope.workspace_id ?? ""}:${scope.target}`} label={label}
            description={item.last_error ? `整理遇到问题：${item.last_error}` : item.backlog ? `${item.backlog} 条材料待整理` : "已启用"}
            trailing={<Button disabled={busy} on_click={() => void configure(scope, false)}>关闭</Button>} />;
        })}
      </Group>
      {!adding ? <Inline><Button disabled={busy || !scopes?.agents.length} on_click={() => set_adding(true)}>启用整理</Button></Inline> : <>
        <Field label="Agent"><Select value={agent_id} disabled={busy}
          options={[{ value: "", label: "请选择 Agent" }, ...(scopes?.agents ?? []).map((agent) => ({ value: agent.agent_id, label: agent.name }))]}
          on_value_change={set_agent_id} /></Field>
        <Inline><Button disabled={busy} on_click={() => set_advanced((value) => !value)}>{advanced ? "收起项目选项" : "项目选项"}</Button></Inline>
        {advanced ? <>
          <Field label="项目" description="选择此 Agent 在哪个项目中的材料。">
            <Select value={workspace_id} disabled={busy}
              options={[{ value: "", label: "无项目" }, ...(scopes?.workspaces ?? []).map((workspace) => ({ value: workspace.workspace_id, label: workspace.name }))]}
              on_value_change={(value) => { set_workspace_id(value); set_share(false); }} />
          </Field>
          {workspace_id ? <Field label="整理结果"><Select value={share ? "shared" : "private"} disabled={busy}
            options={[{ value: "private", label: "仅 Agent 可见" }, { value: "shared", label: "允许项目共享" }]}
            on_value_change={(value) => set_share(value === "shared")} /></Field> : null}
        </> : null}
        <Inline>
          <Button variant="primary" disabled={busy || !agent_id || duplicate} on_click={() => void configure(selected_scope, true)}>{busy ? "保存中…" : "启用"}</Button>
          <Button disabled={busy} on_click={() => { set_adding(false); set_agent_id(""); set_workspace_id(""); set_share(false); set_advanced(false); }}>取消</Button>
          {duplicate ? <Status>已启用</Status> : null}
        </Inline>
      </>}
    </> : null}
  </Section>;
}

/** 保留读取失败，避免把错误展示为未启用。 */
function error_message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
