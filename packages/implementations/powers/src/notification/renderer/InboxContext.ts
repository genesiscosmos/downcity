/** Inbox两个插槽共用的订阅与选择行为；离开草稿前确认，不把输入写进路由或Store。 */
import { useEffect, useSyncExternalStore } from "react";
import type { PowerSidebarComponentProps } from "@downcity/city/power/react";
import type { InboxEntry, InboxView } from "../types/Inbox.js";
import { InboxStore } from "./InboxStore.js";

/** 初始快照与后台刷新均复用一次查询；宿主变更事件只要求重读。 */
export function use_inbox(store: InboxStore, props: PowerSidebarComponentProps) {
  const state = useSyncExternalStore(store.subscribe, store.get_snapshot, store.get_snapshot);
  const { power, navigation, ui } = props;
  useEffect(() => store.attach(power), [store, power]);
  useEffect(() => { void store.refresh(); }, [store, ui.revision]);
  const route_view = navigation.route.view;
  const view: InboxView = route_view === "updates" || route_view === "pending" || route_view === "all"
    ? route_view : state.data?.badge_count ? "pending" : "updates";
  // 首次成功读取后固定默认筛选，后续计数变化不会把用户切到另一个列表。
  useEffect(() => {
    if (state.data && route_view !== "pending" && route_view !== "updates" && route_view !== "all") navigation.navigate({ view });
  }, [state.data, route_view, view, navigation]);
  const can_leave = async (): Promise<boolean> => {
    if (store.get_snapshot().busy_key) return false;
    if (!store.get_snapshot().dirty_key) return true;
    return await ui.confirm({ title: "离开未提交的回答？", description: "当前填写的内容会清除。", action: "清除并切换" });
  };
  const choose = async (entry: InboxEntry) => {
    if (store.get_snapshot().selected[view]?.key === entry.key) return;
    if (!await can_leave()) return;
    store.select(entry, view);
  };
  const close = async () => {
    if (await can_leave()) store.close(view);
  };
  const change_view = async (next_view: InboxView) => {
    if (next_view === view || !await can_leave()) return;
    store.clear_dirty();
    store.close(view);
    navigation.navigate({ view: next_view });
  };
  return { state, view, choose, close, change_view };
}
