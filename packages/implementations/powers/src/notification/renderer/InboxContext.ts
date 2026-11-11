/** Inbox两个插槽共用的订阅与选择行为；离开草稿前确认，不把输入写进路由或Store。 */
import { useEffect, useSyncExternalStore } from "react";
import type { PowerSidebarComponentProps } from "@downcity/city/power/react";
import type { InboxEntry } from "../types/Inbox.js";
import { InboxStore } from "./InboxStore.js";

/** 初始快照与后台刷新均复用一次查询；宿主变更事件只要求重读。 */
export function use_inbox(store: InboxStore, props: PowerSidebarComponentProps) {
  const state = useSyncExternalStore(store.subscribe, store.get_snapshot, store.get_snapshot);
  const { power, ui } = props;
  useEffect(() => store.attach(power), [store, power]);
  useEffect(() => { void store.refresh(); }, [store, ui.revision]);
  const can_leave = async (): Promise<boolean> => {
    if (store.get_snapshot().busy_key) return false;
    if (!store.get_snapshot().dirty_key) return true;
    return await ui.confirm({ title: "离开未提交的回答？", description: "当前填写的内容会清除。", action: "清除并切换" });
  };
  const choose = async (entry: InboxEntry) => {
    if (store.get_snapshot().selected?.key === entry.key) return;
    if (!await can_leave()) return;
    store.select(entry);
  };
  const close = async () => {
    if (await can_leave()) store.close();
  };
  return { state, choose, close };
}
