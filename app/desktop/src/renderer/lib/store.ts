/**
 * Desktop Renderer 的 domain store 基元。
 *
 * 每个 store 是一份不可变快照 + 订阅集合：
 * - subscribe / get_snapshot 供 useSyncExternalStore 消费；
 * - commit 统一更新快照并通知订阅者；
 * - state_ref 供组合层同步读取最新值（不触发渲染）。
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { Store, StoreController } from "@/types/DesktopStore";

export type { Store } from "@/types/DesktopStore";

/**
 * 订阅 store 的最小切片。
 *
 * 选择器必须返回稳定引用（禁止在内部 sort / filter / find / flatMap 构造新数组/对象），
 * 否则 useSyncExternalStore 会在每次渲染判定为变化，造成无限重渲染。
 */
export function use_store_selector<State, Slice>(
  store: Store<State>,
  selector: (state: State) => Slice,
): Slice {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get_snapshot()),
    () => selector(store.get_snapshot()),
  );
}

/**
 * 创建外置不可变快照 store 的 Hook 基元。
 *
 * 快照保存在 ref 中，commit 只更新 ref 并通知订阅者，不经过 useState，
 * 因此不会触发「创建 store 的组件」重渲染；只有用 use_store_selector
 * 订阅的组件才会在自己的切片变化时重渲染。
 */
export function use_store<State>(initial: State): StoreController<State> {
  const state_ref = useRef<State>(initial);
  const listeners_ref = useRef(new Set<() => void>());
  const commit = useCallback((next: State) => {
    if (Object.is(state_ref.current, next)) return;
    state_ref.current = next;
    for (const listener of listeners_ref.current) listener();
  }, []);
  const store = useMemo<Store<State>>(() => ({
    subscribe(listener) {
      listeners_ref.current.add(listener);
      return () => {
        listeners_ref.current.delete(listener);
      };
    },
    get_snapshot() {
      return state_ref.current;
    },
  }), []);
  return { store, state_ref, commit };
}
