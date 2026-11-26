/** Notes Desktop 界面：只使用宿主 UI 组件和已绑定 Power 身份的业务网关。 */
import { useEffect, useState } from "react";
import type { PowerMainviewComponentProps, PowerSidebarComponentProps } from "@downcity/city/power/react";
import type { NotesListResult } from "../../shared/notes_contract.js";

/** 导航由宿主持有，不把 Desktop 路由写进共享后端契约。 */
export function NotesSidebar({ ui, navigation }: PowerSidebarComponentProps) {
  const { Sidebar, SidebarItem } = ui.components;
  return <Sidebar><SidebarItem label="Notes" active on_select={() => navigation.navigate({ view: "notes" })} /></Sidebar>;
}

/** 读取操作持有本次页面的网关，卸载后丢弃迟到响应。 */
export function NotesMainview({ power, ui }: PowerMainviewComponentProps) {
  const [result, set_result] = useState<NotesListResult>();
  const [error, set_error] = useState("");
  useEffect(() => {
    let disposed = false;
    void power.invoke<NotesListResult>("notes.list").then((value) => {
      if (!disposed) set_result(value);
    }).catch((reason: unknown) => {
      if (!disposed) set_error(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { disposed = true; };
  }, [power]);
  const { Page, Group, Row, Callout, LoadingState, EmptyState } = ui.components;
  return <Page>{error ? <Callout tone="danger">{error}</Callout>
    : !result ? <LoadingState label="Loading notes…" />
      : !result.notes.length ? <EmptyState title="No notes" />
        : <Group>{result.notes.map((note) => <Row key={note.note_id} label={note.title} />)}</Group>}</Page>;
}
