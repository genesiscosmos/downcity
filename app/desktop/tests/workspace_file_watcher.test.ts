/**
 * Workspace 文件监听行为测试。
 *
 * 这个模块的价值全在「什么时候通知、什么时候不通知」，因此这里用真实文件系统验证：
 * 通知漏了，预览会永远停在旧内容上；通知多了，用户每次保存都会被无意义地重读一次。
 *
 * 覆盖四类最容易写错的路径：
 * 1. 原地写入与**原子保存**（临时文件 + rename）——后者是编辑器最常见的保存方式，
 *    也是「直接监听文件本身」会失效的场景。
 * 2. 无关文件的变化不得误报。
 * 3. 「读文件」与「登记监听」之间空窗内发生的写入必须补发通知。
 * 4. 释放按订阅粒度生效，不影响同一文件的其它订阅。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkspaceFileWatcher } from "../src/main/workspace/WorkspaceFileWatcher.ts";

/** 等待去抖与指纹比对完成；比去抖窗口宽裕一些，避免慢机器上偶发失败。 */
const SETTLE_MS = 400;

/** 建一个临时目录并在测试结束后清理。 */
async function with_temp_directory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "downcity-watch-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** 建一个监听器并收集它发布的通知，测试结束后释放全部监听。 */
async function with_watcher(run: (watcher: WorkspaceFileWatcher, events: string[]) => Promise<void>): Promise<void> {
  const events: string[] = [];
  const watcher = new WorkspaceFileWatcher((workspace_id, relative_path) => events.push(`${workspace_id}:${relative_path}`));
  try {
    await run(watcher, events);
  } finally {
    watcher.dispose();
  }
}

/** 登记一个监听目标；`known_modified_at` 默认取当前值，避免测试被空窗补发干扰。 */
function watch_options(absolute_path: string, overrides: { subscription_id?: string; known_modified_at?: number } = {}) {
  return {
    subscription_id: overrides.subscription_id ?? "sub-1",
    subscriber_id: 1,
    workspace_id: "ws",
    relative_path: "note.md",
    absolute_path,
    known_modified_at: overrides.known_modified_at ?? 0,
  };
}

test("原地写入触发一次通知", async () => {
  await with_temp_directory(async (directory) => {
    const file = path.join(directory, "note.md");
    await writeFile(file, "v1\n");
    await with_watcher(async (watcher, events) => {
      await watcher.watch(watch_options(file));
      const before = events.length;
      await writeFile(file, "v2 changed\n");
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      assert.equal(events.length, before + 1);
    });
  });
});

test("原子保存（临时文件 + rename）也能触发通知", async () => {
  await with_temp_directory(async (directory) => {
    const file = path.join(directory, "note.md");
    await writeFile(file, "v1\n");
    await with_watcher(async (watcher, events) => {
      await watcher.watch(watch_options(file));
      const before = events.length;
      const temp = path.join(directory, ".note.md.tmp");
      await writeFile(temp, "v2 atomic\n");
      await rename(temp, file);
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      assert.equal(events.length, before + 1);
    });
  });
});

test("同目录内无关文件的变化不触发通知", async () => {
  await with_temp_directory(async (directory) => {
    const file = path.join(directory, "note.md");
    await writeFile(file, "v1\n");
    await with_watcher(async (watcher, events) => {
      await watcher.watch(watch_options(file));
      const before = events.length;
      await writeFile(path.join(directory, "other.md"), "noise\n");
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      assert.equal(events.length, before);
    });
  });
});

test("登记时携带的版本已过期则立即补发一次通知", async () => {
  await with_temp_directory(async (directory) => {
    const file = path.join(directory, "note.md");
    await writeFile(file, "v1\n");
    await with_watcher(async (watcher, events) => {
      // 模拟「读完文件」与「登记监听」之间文件被改写：订阅方手里那一版不是当前版本。
      await watcher.watch(watch_options(file, { known_modified_at: 1 }));
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      assert.deepEqual(events, ["ws:note.md"]);
    });
  });
});

test("释放一个订阅不影响同一文件上的其它订阅", async () => {
  await with_temp_directory(async (directory) => {
    const file = path.join(directory, "note.md");
    await writeFile(file, "v1\n");
    await with_watcher(async (watcher, events) => {
      await watcher.watch(watch_options(file, { subscription_id: "sub-a" }));
      await watcher.watch(watch_options(file, { subscription_id: "sub-b" }));
      await watcher.watch(watch_options(file, { subscription_id: "sub-c" }));
      const before = events.length;
      watcher.release("sub-a");
      await writeFile(file, "v2 changed\n");
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      // 释放一个后仍有两个订阅在等：一次变化应对它们各发一条。
      assert.equal(events.length, before + 2);
    });
  });
});

test("全部订阅释放后不再通知", async () => {
  await with_temp_directory(async (directory) => {
    const file = path.join(directory, "note.md");
    await writeFile(file, "v1\n");
    await with_watcher(async (watcher, events) => {
      await watcher.watch(watch_options(file));
      watcher.release("sub-1");
      const before = events.length;
      await writeFile(file, "v2 changed\n");
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      assert.equal(events.length, before);
    });
  });
});
