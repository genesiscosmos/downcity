/**
 * 当前打开文件的磁盘变化订阅。
 *
 * ## 它解决什么
 *
 * 预览的读取只发生在打开那一刻，此前没有任何东西会在磁盘上那份文件被改写后把新内容取回来：
 * 预览会一直停在旧内容上，只有切走再切回、或关掉标签页重开才能看到新版本。
 * 本 Hook 补上这条通路——文件在外部被改写时，返回的版本号递增，调用方据此重读。
 *
 * ## 登记与释放的时机
 *
 * | 时刻 | 动作 |
 * |---|---|
 * | 本路径首次读到内容 | `watch_file` 登记监听 |
 * | 磁盘变化通知到达 | 版本号递增，调用方重读 |
 * | 换成另一个文件 / 组件卸载 | `unwatch_file` 释放 |
 *
 * 两条容易写错的地方：
 *
 * 1. **登记不能跟随每次重读。** 重读会带来新的修改时间，但主进程在发布通知前已经用
 *    自己的指纹刷新了基准，不需要渲染器再登记一遍。若把修改时间放进依赖里，每次保存
 *    都会经历一次「释放 → 重新登记」，中间那一瞬监听是断的，恰好落在这个窗口里的写入会被漏掉。
 * 2. **读失败不能释放监听。** 文件被删除时重读会失败，但那正是最需要继续盯着的时候：
 *    编辑器「删除后重建」的保存方式、以及用户手动删了又放回来，都要靠这条监听才能发现。
 *    因此释放只由「换文件」与「卸载」触发，不由读取结果触发。
 *
 * `subscription_id` 在组件实例内固定：主进程按它精确释放，因此同一个窗口里两处预览
 * 同一个文件时，其中一处卸载不会掐掉另一处的热更新。窗口异常销毁时主进程还会按
 * webContents 兜底整批释放，所以这里不必处理「渲染器没来得及退订」的情况。
 *
 * ## 为什么版本号是「读到了什么」而不是「发生了什么」
 *
 * 事件只说明目录里有动静（见主进程 `WorkspaceFileWatcher`），内容是否真的变了由主进程
 * 用文件指纹判定。因此这里只做两件确定的事：按路径精确过滤，然后让调用方重读一次。
 * 重读本身是幂等的——即使收到一次多余通知，代价也只是一次读盘。
 */

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 订阅一个文件的磁盘变化。
 *
 * `loaded_modified_at` 传调用方刚读到那一版的修改时间：读文件与登记监听之间存在一个空窗，
 * 主进程据此发现并补发通知。尚未读到（首次读取进行中）时传 `undefined`，此时不登记监听。
 *
 * 返回的版本号每次收到该文件的变化通知都递增；调用方把它放进重读的依赖里即可。
 */
export function use_workspace_file_revision(workspace_id: string, relative_path: string, loaded_modified_at?: number): number {
  const [revision, set_revision] = useState(0);
  // 每个预览实例一个订阅标识：同一个文件被多处打开时各自独立登记与释放。
  const subscription_id = useMemo(() => crypto.randomUUID(), []);
  // 登记时回传的修改时间：经 ref 取值，不进入依赖（否则每次重读都会拆建一次监听）。
  const loaded_modified_at_ref = useRef(loaded_modified_at);
  loaded_modified_at_ref.current = loaded_modified_at;
  const key = `${workspace_id}\n${relative_path}`;
  // 已成功读到过的路径键。它只在「本路径读到内容」时前进，读失败不后退，
  // 因此文件被删除时监听仍然留着，重建才能被发现。
  const [armed_key, set_armed_key] = useState<string | undefined>(undefined);

  // 变化通知：按 Workspace 与相对路径精确过滤，其它文件的变化与本实例无关。
  useEffect(() => {
    if (!relative_path) return;
    return window.downcity.workspace.on_file_changed((event) => {
      if (event.workspace_id !== workspace_id || event.relative_path !== relative_path) return;
      set_revision((current) => current + 1);
    });
  }, [workspace_id, relative_path]);

  // 首次读到内容即「武装」本路径；此后重读（含失败）不再改动它。
  useEffect(() => {
    if (relative_path && loaded_modified_at !== undefined) set_armed_key(key);
  }, [key, relative_path, loaded_modified_at]);

  // 登记与释放：只在「武装了本路径」与「换文件 / 卸载」时发生。
  useEffect(() => {
    if (!relative_path || armed_key !== key) return;
    void window.downcity.workspace.watch_file(workspace_id, relative_path, loaded_modified_at_ref.current ?? 0, subscription_id).catch(() => undefined);
    return () => { void window.downcity.workspace.unwatch_file(subscription_id).catch(() => undefined); };
  }, [workspace_id, relative_path, key, armed_key, subscription_id]);

  return revision;
}
