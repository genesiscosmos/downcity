/** 用户长期知识：无 Agent/项目执行选择，读写通过仅授权 User 的宿主管理接口。 */
import { useEffect, useState } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { MemoryMainviewListResult } from "../types/MemoryMainview.js";
import type { MemoryReadResult, MemoryRecord } from "../types/Memory.js";

const PAGE_SIZE = 30;

/** 搜索列表与正文编辑共用真实读取版本，迟到响应不得替换已切换的详情。 */
export function memory_user_knowledge({ power, ui }: PowerMainviewComponentProps) {
  const { Button, Callout, EmptyState, Field, Group, Inline, Input, LoadingState, Markdown, Row, Section, Status, Textarea, Toolbar } = ui.components;
  const [listing, set_listing] = useState<MemoryMainviewListResult>();
  const [query, set_query] = useState("");
  const [offset, set_offset] = useState(0);
  const [revision, set_revision] = useState(0);
  const [loading, set_loading] = useState(true);
  const [selected_id, set_selected_id] = useState("");
  const [record, set_record] = useState<MemoryRecord>();
  const [reading, set_reading] = useState(false);
  const [editing, set_editing] = useState(false);
  const [edit_version, set_edit_version] = useState("");
  const [creating, set_creating] = useState(false);
  const [draft, set_draft] = useState("");
  const [request_id, set_request_id] = useState(() => crypto.randomUUID());
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState("");
  useEffect(() => {
    let disposed = false;
    set_loading(true); set_error("");
    void power.invoke<MemoryMainviewListResult>("memory.user_knowledge.list", { query, offset, limit: PAGE_SIZE })
      .then((value) => { if (!disposed) set_listing(value); })
      .catch((reason) => { if (!disposed) set_error(error_text(reason)); })
      .finally(() => { if (!disposed) set_loading(false); });
    return () => { disposed = true; };
  }, [power, query, offset, revision, ui.revision]);
  useEffect(() => {
    if (!selected_id) { set_record(undefined); return; }
    let disposed = false;
    set_record(undefined); set_reading(true); set_error("");
    void power.invoke<MemoryReadResult>("memory.user_knowledge.read", { memory_id: selected_id })
      .then((value) => { if (!disposed) { if (!value.memory) throw new Error("这条知识已不存在"); set_record(value.memory); } })
      .catch((reason) => { if (!disposed) set_error(error_text(reason)); })
      .finally(() => { if (!disposed) set_reading(false); });
    return () => { disposed = true; };
  }, [power, selected_id, revision, ui.revision]);
  const mutate = async (action: string, payload: object) => {
    set_busy(true); set_error("");
    try {
      await power.invoke(action, { ...payload, request_id });
      set_editing(false); set_creating(false); set_draft(""); set_revision((value) => value + 1); ui.invalidate();
      ui.toast({ type: "success", message: "用户知识已更新" });
      return true;
    } catch (reason) { set_error(error_text(reason)); return false; }
    finally { set_busy(false); }
  };
  const save = () => {
    if (!draft.trim()) return;
    if (creating) void mutate("memory.user_knowledge.create", { content: draft.trim() });
    else if (record && edit_version) void mutate("memory.user_knowledge.update", { memory_id: record.memory_id, version: edit_version, content: draft.trim() });
  };
  const forget = async () => {
    if (!record || !await ui.confirm({ title: "删除这条用户知识？", description: "所有 Agent 将不再检索到这条知识，历史来源仍保留。", action: "删除", destructive: true })) return;
    if (await mutate("memory.user_knowledge.forget", { memory_id: record.memory_id, version: record.version })) set_selected_id("");
  };
  const change_draft = (value: string) => { set_draft(value); set_request_id(crypto.randomUUID()); };
  const editor = <Section title={creating ? "新增知识" : "修改知识"}>
    <Field label="内容"><Textarea value={draft} rows={7} disabled={busy} on_value_change={change_draft} /></Field>
    <Inline><Button variant="primary" disabled={busy || !draft.trim() || (!creating && !edit_version)} on_click={save}>{busy ? "保存中…" : "保存"}</Button>
      <Button disabled={busy} on_click={() => { set_creating(false); set_editing(false); set_draft(""); }}>取消</Button></Inline>
  </Section>;
  if (selected_id) return <>
    <Toolbar title="知识详情" actions={<Inline>
      <Button disabled={busy} on_click={() => { set_selected_id(""); set_editing(false); }}>返回知识</Button>
      {record ? <><Button disabled={busy || editing || !record.version} on_click={() => { set_editing(true); set_edit_version(record.version ?? ""); change_draft(record.content); }}>修改</Button>
        <Button disabled={busy || editing} on_click={() => void forget()}>删除</Button></> : null}
    </Inline>} />
    {error ? <Callout tone="danger">{error}</Callout> : null}
    {reading ? <LoadingState label="正在读取知识…" /> : null}
    {record ? <>{editing ? editor : <Markdown text={record.content} />}
      <Group label="来源与时间"><Row label="更新时间" description={new Date(record.observed_at).toLocaleString()} />
        {record.source_refs.map((source) => <Row key={source.source_id} label={source.label || (source.source_type === "manual" ? "手动保存" : source.source_type)} description={source.excerpt} />)}
      </Group></> : null}
  </>;
  return <>
    <Toolbar description="关于你的长期事实、背景和经验，所有 Agent 共用。" actions={<Inline>
      <Button disabled={busy || loading} on_click={() => set_revision((value) => value + 1)}>刷新</Button>
      <Button disabled={busy || creating} on_click={() => { set_creating(true); change_draft(""); }}>新增知识</Button>
    </Inline>} />
    <Field label="搜索知识"><Input value={query} placeholder="搜索已保存的内容" on_value_change={(value) => { set_query(value); set_offset(0); }} /></Field>
    {error ? <Callout tone="danger">{error}</Callout> : null}
    {creating ? editor : null}
    {loading ? <LoadingState label="正在读取用户知识…" /> : listing ? <>
      {!listing.items.length ? <EmptyState title={query ? "没有找到相关知识" : "还没有用户知识"} size="compact" />
        : <Group>{listing.items.map((item) => <Row key={item.memory_id} label={item.title} description={item.snippet}
          on_click={() => { if (!creating) { set_selected_id(item.memory_id); set_editing(false); } }} />)}</Group>}
      {listing.total > PAGE_SIZE ? <Inline>
        <Button disabled={busy || offset === 0} on_click={() => set_offset(Math.max(0, offset - PAGE_SIZE))}>上一页</Button>
        <Status>{offset + 1}–{offset + listing.items.length} / {listing.total}</Status>
        <Button disabled={busy || offset + PAGE_SIZE >= listing.total} on_click={() => set_offset(offset + PAGE_SIZE)}>下一页</Button>
      </Inline> : null}
    </> : null}
  </>;
}

/** 失败保留正文草稿和精确版本，用户可刷新后重新审阅。 */
function error_text(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
