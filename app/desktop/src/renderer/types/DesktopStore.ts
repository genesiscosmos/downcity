/** Desktop Renderer 外置 store 的公共类型。 */

import type { RefObject } from "react";

/** 可被 React 外置状态协议消费的稳定 store 句柄。 */
export interface Store<State> {
  /** 订阅快照变化；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void;
  /** 返回当前不可变快照；未变化时必须保持引用一致。 */
  get_snapshot(): State;
}

/** store Hook 基元返回的写入能力。 */
export interface StoreController<State> {
  /** 供组件订阅的稳定只读句柄。 */
  store: Store<State>;
  /** 供领域 action 同步读取最新快照的引用。 */
  state_ref: RefObject<State>;
  /** 原子替换当前不可变快照并通知订阅者。 */
  commit(next: State): void;
}
