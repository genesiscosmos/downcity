/** Inbox 页面与独立详情共用的快照订阅；每个 view 持有自己的 Store。 */
import { useEffect, useSyncExternalStore } from "react";
import type { PowerPageComponentProps } from "@downcity/city/power/react";
import { InboxStore } from "./InboxStore.js";

/** 初始读取和宿主刷新使用同一网关，卸载时释放轮询。 */
export function use_inbox(store: InboxStore, props: Pick<PowerPageComponentProps, "power" | "ui">) {
  const state = useSyncExternalStore(store.subscribe, store.get_snapshot, store.get_snapshot);
  const { power, ui } = props;
  useEffect(() => store.attach(power), [store, power]);
  useEffect(() => { void store.refresh(); }, [store, ui.revision]);
  return { state };
}
