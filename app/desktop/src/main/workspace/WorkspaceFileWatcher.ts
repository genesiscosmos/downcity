/**
 * Workspace 文件的按需监听。
 *
 * ## 为什么是「按需」而不是「整个 Workspace」
 *
 * 只有正在被预览的文件需要热更新。递归监听整个 Workspace 会把成本绑定到目录规模上，
 * 而收益只是顺带刷新一个文件列表的修改时间。这里只为「当前真正打开的文件」建立监听，
 * 订阅方一登记就开始、一释放就停，空闲时进程里没有 watcher。
 *
 * ## 为什么监听父目录而不是文件本身
 *
 * 编辑器保存大多不是原地写：先写临时文件、再 rename 覆盖目标。直接监听文件会跟着
 * 旧 inode 走，rename 之后监听器就失效了——表现为「这个文件从此不再热更新」。
 * 监听父目录并按文件名过滤可以覆盖这种原子保存，也能覆盖「先删后建」。
 *
 * ## 变化判定用指纹而不是事件
 *
 * `fs.watch` 的事件是「这个目录里有过动静」，不保证内容真的变了：一次保存可能连发数个事件，
 * 也可能只是改了权限或读了一下。因此事件只用来触发一次延迟比对，真正决定是否通知的是
 * 文件指纹（修改时间 + 大小）。指纹没变就不通知，避免渲染器做无意义的重读。
 *
 * 代价是「内容改了但指纹没变」的极端情形（同一毫秒内写回同样大小）不会触发通知。
 * 这与所有基于 mtime 的增量方案是同一类取舍，换来的是零额外读盘与稳定行为。
 *
 * ## 订阅身份分两层
 *
 * | 标识 | 谁生成 | 生命周期 | 用途 |
 * |---|---|---|---|
 * | `subscription_id` | 渲染器（每个预览实例一个） | 该实例卸载 | 精确释放，不误伤同一窗口里的其它预览 |
 * | `subscriber_id` | 主进程（webContents id） | 窗口销毁 | 兜底整批释放，覆盖渲染器没来得及退订的情况 |
 *
 * 两层都必要：只用窗口标识时，同一个窗口里两处预览同一个文件会共用一个条目，
 * 其中一处卸载就会静默掐掉另一处的热更新；只用订阅标识时，窗口异常销毁会留下无人认领的监听。
 */

import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceFileWatchRequest, WorkspaceFileWatchTarget } from "@/types/workspace/WorkspaceFileWatcher.js";

/** 一次事件之后等待多久再做指纹比对；用于合并编辑器保存产生的连续事件。 */
const WATCH_DEBOUNCE_MS = 120;

/** 监听器对外发布变化通知的入口。 */
export type WorkspaceFileChangePublisher = (workspace_id: string, relative_path: string) => void;

/** 一个绝对路径对应的监听记录。 */
interface WatchedFile {
  /** 父目录监听器。 */
  watcher: FSWatcher;
  /** 最近一次比对时的文件指纹；为空表示登记时文件还读不到。 */
  fingerprint?: string;
  /** 正在等待的比对定时器。 */
  timer?: ReturnType<typeof setTimeout>;
  /** 登记了该文件的订阅，按 `subscription_id` 索引。 */
  subscriptions: Map<string, WorkspaceFileWatchTarget>;
}

/**
 * Workspace 文件监听器。
 *
 * 所有权：本对象拥有全部 `FSWatcher` 与定时器，`dispose` 之后进程里不残留任何监听。
 * 引用计数按绝对路径做：同一个文件被多处打开只监听一次，最后一个订阅释放时才关闭。
 */
export class WorkspaceFileWatcher {
  /** 已建立监听的绝对路径。 */
  private readonly watched = new Map<string, WatchedFile>();
  /** 变化通知的出口。 */
  private readonly publish: WorkspaceFileChangePublisher;

  constructor(publish: WorkspaceFileChangePublisher) {
    this.publish = publish;
  }

  /**
   * 登记一个监听目标。
   *
   * 同一 `subscription_id` 重复登记同一文件时覆盖旧记录（幂等），
   * 因此渲染器可以在依赖变化时放心地重新调用，不必先精确释放。
   */
  async watch(target: WorkspaceFileWatchTarget): Promise<void> {
    const existing = this.watched.get(target.absolute_path);
    if (existing) {
      existing.subscriptions.set(target.subscription_id, target);
      // 已有监听：仍需判断订阅方手里那一版是否已经过期，缺了这一步它可能永远停在旧内容上。
      await this.report_if_stale(target, existing);
      return;
    }
    const entry = await this.create_entry(target);
    if (!entry) return;
    this.watched.set(target.absolute_path, entry);
    await this.report_if_stale(target, entry);
  }

  /** 释放一个订阅；该文件没有其它订阅时一并关闭监听。 */
  release(subscription_id: string): void {
    for (const [absolute_path, entry] of this.watched) {
      if (!entry.subscriptions.delete(subscription_id)) continue;
      if (entry.subscriptions.size === 0) this.close_entry(absolute_path, entry);
    }
  }

  /** 释放一个窗口持有的全部订阅；窗口销毁时兜底调用。 */
  release_subscriber(subscriber_id: number): void {
    for (const [absolute_path, entry] of this.watched) {
      for (const [subscription_id, target] of entry.subscriptions) {
        if (target.subscriber_id === subscriber_id) entry.subscriptions.delete(subscription_id);
      }
      if (entry.subscriptions.size === 0) this.close_entry(absolute_path, entry);
    }
  }

  /** 释放全部监听与定时器。 */
  dispose(): void {
    for (const [absolute_path, entry] of this.watched) this.close_entry(absolute_path, entry);
    this.watched.clear();
  }

  /** 建立一个文件的父目录监听；父目录不可监听时返回 undefined，不抛错。 */
  private async create_entry(target: WorkspaceFileWatchTarget): Promise<WatchedFile | undefined> {
    const directory = path.dirname(target.absolute_path);
    const file_name = path.basename(target.absolute_path);
    const entry: WatchedFile = { watcher: undefined as unknown as FSWatcher, subscriptions: new Map([[target.subscription_id, target]]) };
    try {
      entry.watcher = watch(directory, { persistent: false }, (_event_type, changed_name) => {
        // 部分平台不回报文件名：此时无法区分，只能当作本文件可能变化，交给指纹比对否决。
        if (changed_name && path.basename(String(changed_name)) !== file_name) return;
        this.schedule_check(target.absolute_path, entry);
      });
    } catch {
      // 目录被删除或权限不足：预览本身仍然可用，只是不热更新。
      return undefined;
    }
    entry.watcher.on("error", () => {
      // 监听在系统层面失效（目录被移走等）：主动收掉，避免留下一个永远不再触发的事件源。
      this.close_entry(target.absolute_path, entry);
    });
    entry.fingerprint = await read_fingerprint(target.absolute_path);
    return entry;
  }

  /** 合并短时间内的连续事件，只做一次比对。 */
  private schedule_check(absolute_path: string, entry: WatchedFile): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.check(absolute_path, entry);
    }, WATCH_DEBOUNCE_MS);
  }

  /** 比对指纹，变化则向所有订阅方发布通知。 */
  private async check(absolute_path: string, entry: WatchedFile): Promise<void> {
    if (!this.watched.has(absolute_path)) return;
    const fingerprint = await read_fingerprint(absolute_path);
    // 指纹相同视为未变化：事件是「有动静」，不是「内容变了」。
    if (fingerprint === entry.fingerprint) return;
    entry.fingerprint = fingerprint;
    // 删除与重建同样要通知：订阅方重读会失败并显示原因，比停在旧内容上诚实。
    for (const target of entry.subscriptions.values()) this.publish(target.workspace_id, target.relative_path);
  }

  /**
   * 登记时补一次通知，收掉「读文件」与「登记监听」之间的空窗。
   *
   * 两次调用之间文件被改写时，监听基准会取到新版本，订阅方却停在旧内容上，
   * 而且此后不再有任何事件把它叫醒。订阅方带上自己读到的版本即可在这里发现并补发。
   */
  private async report_if_stale(target: WorkspaceFileWatchTarget, entry: WatchedFile): Promise<void> {
    if (target.known_modified_at === undefined) return;
    const file_stat = await stat(target.absolute_path).catch(() => undefined);
    if (!file_stat || file_stat.mtimeMs === target.known_modified_at) return;
    entry.fingerprint = `${file_stat.mtimeMs}:${file_stat.size}`;
    this.publish(target.workspace_id, target.relative_path);
  }

  /** 关闭一个文件的监听并清掉它的定时器。 */
  private close_entry(absolute_path: string, entry: WatchedFile): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.subscriptions.clear();
    this.watched.delete(absolute_path);
    try {
      entry.watcher?.close();
    } catch {
      // 已经关闭或目录已消失：无需处理。
    }
  }
}

/** 读取文件指纹；文件不存在或不可读时返回 undefined。 */
async function read_fingerprint(absolute_path: string): Promise<string | undefined> {
  const file_stat = await stat(absolute_path).catch(() => undefined);
  return file_stat?.isFile() ? `${file_stat.mtimeMs}:${file_stat.size}` : undefined;
}
