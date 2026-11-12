/** 用户持续约定：来源标记保持内部管理，每次编辑携带实际读取版本及唯一原文。 */
import { useEffect, useState } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { ProfileDocument } from "../types/Profile.js";

/** 按内部来源边界呈现约定正文，追加和精确编辑不改写来源标记。 */
export function memory_user_profile({ power, ui }: PowerMainviewComponentProps) {
  const { Button, Callout, EmptyState, Field, Inline, ItemMenu, LoadingState, Markdown, Section, Textarea, Toolbar } = ui.components;
  const [profile, set_profile] = useState<ProfileDocument>();
  const [revision, set_revision] = useState(0);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState("");
  const [busy, set_busy] = useState(false);
  const [editing, set_editing] = useState<string | null>(null);
  const [draft, set_draft] = useState("");
  const [edit_version, set_edit_version] = useState("");
  const [request_id, set_request_id] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let disposed = false;
    set_loading(true); set_error("");
    void power.invoke<ProfileDocument>("memory.profile_read", { target: "user" })
      .then((value) => { if (!disposed) set_profile(value); })
      .catch((reason) => { if (!disposed) set_error(error_text(reason)); })
      .finally(() => { if (!disposed) set_loading(false); });
    return () => { disposed = true; };
  }, [power, revision, ui.revision]);
  const blocks = profile?.content.split(/<!-- memory-source:[a-f0-9]+(?::[a-f0-9]+)? -->\n?/gu).map((text) => text.trim()).filter(Boolean) ?? [];
  const start_edit = (original: string) => { set_editing(original); set_edit_version(profile?.version ?? ""); set_draft(original); set_request_id(crypto.randomUUID()); };
  const mutate = async (action: string, payload: object) => {
    set_busy(true); set_error("");
    try {
      await power.invoke(action, { target: "user", ...payload });
      set_editing(null); set_draft(""); set_revision((value) => value + 1); ui.invalidate();
      ui.toast({ type: "success", message: "持续约定已更新" });
    } catch (reason) { set_error(error_text(reason)); }
    finally { set_busy(false); }
  };
  const save = () => {
    if (!profile || !draft.trim() || editing === null) return;
    if (editing === "") void mutate("memory.profile_append", { content: draft.trim(), version: edit_version, request_id });
    else void mutate("memory.profile_edit", { version: edit_version, edits: [{ old_text: editing, new_text: draft.trim() }] });
  };
  const remove = async (text: string) => {
    if (!profile || !await ui.confirm({ title: "删除这条持续约定？", description: "后续上下文将不再使用这条约定，历史记录仍保留。", action: "删除", destructive: true })) return;
    if (blocks.length === 1) await mutate("memory.profile_delete", { version: profile.version });
    else await mutate("memory.profile_edit", { version: profile.version, edits: [{ old_text: text, new_text: "" }] });
  };
  if (loading && !profile) return <LoadingState label="正在读取用户持续约定…" />;
  return <>
    <Toolbar description="所有 Agent 共用，会影响以后的回答与协作方式。" actions={<Inline>
      <Button disabled={busy || loading} on_click={() => set_revision((value) => value + 1)}>刷新</Button>
      <Button disabled={busy || !profile || editing !== null} on_click={() => start_edit("")}>新增约定</Button>
    </Inline>} />
    {error ? <Callout tone="danger">{error}</Callout> : null}
    {editing !== null ? <Section title={editing ? "修改约定" : "新增约定"}>
      <Field label="内容"><Textarea value={draft} rows={5} disabled={busy} on_value_change={(value) => { set_draft(value); set_request_id(crypto.randomUUID()); }} /></Field>
      <Inline><Button variant="primary" disabled={busy || !draft.trim() || (editing !== "" && draft.trim() === editing)} on_click={save}>{busy ? "保存中…" : "保存"}</Button>
        <Button disabled={busy} on_click={() => { set_editing(null); set_draft(""); }}>取消</Button></Inline>
    </Section> : null}
    {profile && !blocks.length && editing === null ? <EmptyState title="还没有持续约定" description="保存称呼、回答习惯或长期协作规则。" size="compact" /> : null}
    {blocks.map((text, index) => <Section key={`${index}:${text}`} action={<ItemMenu label="约定操作" actions={[
      { action_id: "edit", label: "修改", disabled: busy || editing !== null || profile?.content.indexOf(text) !== profile?.content.lastIndexOf(text), on_select: () => start_edit(text) },
      { action_id: "delete", label: "删除", destructive: true, disabled: busy || editing !== null || profile?.content.indexOf(text) !== profile?.content.lastIndexOf(text), on_select: () => remove(text) },
    ]} />}><Markdown text={text} /></Section>)}
  </>;
}

/** 操作失败保留草稿与读取版本，避免覆盖并发更新。 */
function error_text(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
