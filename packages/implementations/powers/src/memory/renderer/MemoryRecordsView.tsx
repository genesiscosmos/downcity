/** User、Agent、Workspace 复用的按条管理内容；沿用宿主共享组件与实际读取版本。 */
import { useEffect, useState } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { MemoryKind, MemoryRecord, MemoryReadResult, MemoryListResult, MemoryWriteResult, MemoryScopeType } from "../types/MemoryProtocol.js";
import type { MemoryAgreementBudget } from "../types/MemoryManagement.js";
import { memory_display_label } from "../runtime/MemorySchema.js";

import type { MemoryRecordsViewProps } from "../types/MemoryRenderer.js";
/** 保存失败保留草稿及旧版本，避免用最新版本机械覆盖。 */
export function Memory_records_view({ power, ui, scope, kind, agent_id, workspace_id, initial_memory_id }: MemoryRecordsViewProps) {
  const { Button, Callout, EmptyState, Field, Group, Inline, Input, LoadingState, Markdown, Row, Section, Status, Textarea, Toolbar } = ui.components;
  const [listing, set_listing] = useState<MemoryListResult>();
  const [query, set_query] = useState("");
  const [offset, set_offset] = useState(0);
  const [revision, set_revision] = useState(0);
  const [loading, set_loading] = useState(true);
  const [selected_id, set_selected_id] = useState(initial_memory_id ?? "");
  const [record, set_record] = useState<MemoryRecord>();
  const [budget, set_budget] = useState<MemoryAgreementBudget>();
  const [history, set_history] = useState<MemoryRecord[]>([]);
  const [show_history, set_show_history] = useState(false);
  const [editing, set_editing] = useState(false);
  const [creating, set_creating] = useState(false);
  const [edit_version, set_edit_version] = useState("");
  const [draft, set_draft] = useState("");
  const [draft_title, set_draft_title] = useState("");
  const [request_id, set_request_id] = useState(() => crypto.randomUUID());
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState("");
  const routing = { scope, ...(agent_id ? { agent_id } : {}), ...(workspace_id ? { workspace_id } : {}) };
  const noun = kind === "agreement" ? "持续约定" : "知识";
  useEffect(() => {
    let disposed = false; set_loading(true);
    const promise = query.trim() ? power.invoke<{ items: { memory: MemoryRecord }[] }>("memory.search", { routing, payload: { query, kind, max_results: 50 } })
      .then((result) => ({ items: result.items.map(({ memory }) => ({ ...memory, label: memory_display_label(memory) })), total: result.items.length, provider: "builtin", scope_counts: { user: 0, agent: 0, workspace: 0 } }))
      : power.invoke<MemoryListResult>("memory.list", { routing, payload: { kind, offset, limit: 30 } });
    void promise.then((value) => { if (!disposed) set_listing(value); })
      .catch((reason) => { if (!disposed) set_error(String(reason)); })
      .finally(() => { if (!disposed) set_loading(false); });
    return () => { disposed = true; };
  }, [power, scope, kind, agent_id, workspace_id, query, offset, revision, ui.revision]);
  useEffect(() => {
    set_show_history(false); set_history([]);
    if (!selected_id) { set_record(undefined); return; }
    let disposed = false; set_record(undefined);
    void power.invoke<MemoryReadResult>("memory.read", { routing, payload: { memory_id: selected_id } })
      .then((result) => { if (!disposed) { set_record(result.memory ?? undefined); if (!result.memory) set_error("记忆已删除或不可用"); } })
      .catch((reason) => { if (!disposed) set_error(String(reason)); });
    return () => { disposed = true; };
  }, [power, selected_id, revision, scope, agent_id, workspace_id, ui.revision]);
  useEffect(() => {
    if (kind !== "agreement") return;
    let disposed = false;
    void power.invoke<MemoryAgreementBudget>("memory.agreement_budget", routing)
      .then(value => { if (!disposed) set_budget(value); }).catch(reason => { if (!disposed) set_error(String(reason)); });
    return () => { disposed = true; };
  }, [power, scope, kind, agent_id, workspace_id, revision, ui.revision]);
  const reset_request = () => set_request_id(crypto.randomUUID());
  const mutate = async (action: string, payload: object) => {
    set_busy(true); set_error("");
    try {
      const receipt = await power.invoke<MemoryWriteResult>(`memory.${action}`, { routing, payload: { ...payload, request_id } });
      if (!["committed", "unchanged"].includes(receipt.status)) throw new Error("操作尚未提交");
      reset_request();
      set_editing(false); set_creating(false); set_draft(""); set_revision((value) => value + 1); ui.invalidate();
      if (action === "forget") { set_record(undefined); set_selected_id(""); }
      ui.toast({ type: "success", message: action === "forget" ? "已删除" : receipt.status === "unchanged" ? "内容未变" : "已保存" });
    } catch (reason) { set_error(String(reason)); } finally { set_busy(false); }
  };
  const load_history = async () => {
    set_error("");
    try { const result = await power.invoke<{ records: MemoryRecord[] }>("memory.history", { routing, payload: { memory_id: selected_id } }); set_history(result.records); set_show_history(true); }
    catch (reason) { set_error(String(reason)); }
  };
  const editor = <Section title={creating ? `新增${noun}` : `修改${noun}`}>
    {kind === "knowledge" ? <Field label="标题"><Input value={draft_title} disabled={busy} on_value_change={(value) => { set_draft_title(value); reset_request(); }} /></Field> : null}
    {editing && record && edit_version !== record.version ? <Callout tone="warning">记录已更新。草稿仍基于旧版本，请核对当前正文后再确认编辑基线。<Button on_click={() => { set_edit_version(record.version); reset_request(); }}>已核对当前版本</Button><Markdown text={record.content} /></Callout> : null}
    <Field label="内容"><Textarea value={draft} rows={8} disabled={busy} on_value_change={(value) => { set_draft(value); reset_request(); }} /></Field>
    <Inline><Button variant="primary" disabled={busy || !draft.trim() || (editing && record?.version !== edit_version) || (kind === "knowledge" && !draft_title.trim())} on_click={() => void mutate(creating ? "remember" : "update", {
      ...(creating ? { scope, kind } : { memory_id: record!.memory_id, expected_version: edit_version }),
      content: draft, ...(kind === "knowledge" ? { title: draft_title } : {}),
    })}>{busy ? "保存中…" : "保存"}</Button><Button disabled={busy} on_click={() => { set_editing(false); set_creating(false); }}>取消</Button></Inline>
  </Section>;
  if (selected_id) return <>
    <Toolbar title={record ? memory_display_label(record) : noun} actions={<Inline>
      <Button disabled={busy} on_click={() => { set_selected_id(""); set_editing(false); set_error(""); }}>返回</Button>
      <Button disabled={busy} on_click={() => set_revision((value) => value + 1)}>刷新</Button>
      {record ? <><Button disabled={busy || editing} on_click={() => { set_edit_version(record.version); set_draft(record.content); set_draft_title(record.kind === "knowledge" ? record.title : ""); set_editing(true); reset_request(); }}>修改</Button>
        <Button disabled={busy || editing} on_click={() => void ui.confirm({ title: `删除这条${noun}？`, description: "退出普通召回与约定加载，保留审计历史。", action: "删除", destructive: true }).then((confirmed) => {
          if (confirmed) void mutate("forget", { memory_id: record.memory_id, expected_version: record.version });
        })}>删除</Button></> : null}
    </Inline>} />
    {error ? <Callout tone="danger">{error}</Callout> : null}
    <Button disabled={busy} on_click={() => void load_history()}>历史</Button>
    {show_history ? <Group>{history.map(item => <Row key={item.version} label={new Date(item.updated_at).toLocaleString()} description={item.state === "active" ? item.content : item.state} />)}</Group> : null}
    {record ? <>{editing ? editor : <Markdown text={record.content} />}
      <Group label="来源与时间"><Row label="更新时间" description={new Date(record.updated_at).toLocaleString()} />
        {record.sources.map((source) => <Row key={source.source_id} label={source.source_type === "management_input" ? "直接管理输入" : source.source_type === "request" ? "保存请求" : source.role === "user" ? "用户原文" : "原始资料"} description={source.excerpt ?? source.note} />)}</Group>
    </> : !error ? <LoadingState label="正在读取…" /> : null}
  </>;
  return <>
    {kind === "agreement" && budget ? <Status>{budget.total} 条约定 · 约 {budget.estimated_tokens} tokens</Status> : null}
    <Toolbar actions={<Inline><Button disabled={busy || loading} on_click={() => set_revision((value) => value + 1)}>刷新</Button>
      <Button disabled={busy || creating} on_click={() => { set_creating(true); set_draft(""); set_draft_title(""); reset_request(); }}>新增{noun}</Button></Inline>} />
    <Field label={`搜索${noun}`}><Input value={query} on_value_change={(value) => { set_query(value); set_offset(0); }} /></Field>
    {error ? <Callout tone="danger">{error}</Callout> : null}{creating ? editor : null}
    {loading ? <LoadingState label="正在读取…" /> : listing?.items.length ? <Group>{listing.items.map((item) => <Row key={item.memory_id} label={item.label}
      on_click={() => { if (!creating) { set_selected_id(item.memory_id); set_editing(false); set_error(""); } }} />)}</Group> : <EmptyState title={`还没有${noun}`} size="compact" />}
    {!query && listing && listing.total > 30 ? <Inline><Button disabled={!offset} on_click={() => set_offset(Math.max(0, offset - 30))}>上一页</Button>
      <Status>{offset + 1}–{offset + listing.items.length} / {listing.total}</Status><Button disabled={offset + 30 >= listing.total} on_click={() => set_offset(offset + 30)}>下一页</Button></Inline> : null}
  </>;
}
