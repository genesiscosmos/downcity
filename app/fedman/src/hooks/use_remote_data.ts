/** React 页面远端数据加载 Hook。 */

import { useEffect, useState } from "react";
import type { RemoteDataState } from "../types/ui.js";

/** 在依赖变化时加载远端数据，并忽略已卸载页面的迟到响应。 */
export function use_remote_data<T>(loader: () => Promise<T>, dependencies: readonly unknown[]): RemoteDataState<T> {
  const [state, set_state] = useState<RemoteDataState<T>>({ data: null, loading: true, refreshing: false, error: null });

  useEffect(() => {
    let active = true;
    set_state((current) => ({
      ...current,
      loading: current.data === null,
      refreshing: current.data !== null,
      error: null,
    }));
    void loader().then((data) => {
      if (active) set_state({ data, loading: false, refreshing: false, error: null });
    }).catch((error: unknown) => {
      if (active) set_state((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }));
    });
    return () => { active = false; };
  // loader 由页面根据同一组依赖重新创建，只以调用方声明的业务依赖为准。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return state;
}
