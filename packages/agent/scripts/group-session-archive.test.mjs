/**
 * @file 验证 GroupSession 的归档：目录搬迁、活动/归档两个区、以及不可逆的清理。
 *
 * 归档是**目录搬迁**（`sessions/` → `archived-sessions/`），不是打标记。因此这里的断言
 * 都围绕「位置」：活动列表不含它、归档列表含它、清理只动归档区。
 *
 * 用真实临时目录而不是内存 mock：搬迁本身是文件系统操作，mock 掉它就等于不测它。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalGroupSessionStore } from "../bin/group/storage/LocalGroupSessionStore.js";

/** 创建测试用文件系统协议；只需 Store 用到的那几个能力。 */
function create_files() {
  return {
    root_path: "",
    resolve_path: (...segments) => path.resolve(...segments),
    path_exists: async (target) => await fs.access(target).then(() => true, () => false),
    read_file: async (target) => await fs.readFile(target),
    file_size: async (target) => (await fs.stat(target)).size,
    ensure_directory: async (directory_path) => await fs.mkdir(directory_path, { recursive: true }),
    remove_path: async (target) => await fs.rm(target, { recursive: true, force: true }),
    move_path: async (source, target) => await fs.rename(source, target),
    read_directory: async (directory_path) => {
      const entries = await fs.readdir(directory_path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        is_directory: entry.isDirectory(),
        is_file: entry.isFile(),
      }));
    },
    write_file_atomically: async (file_path, content) => await fs.writeFile(file_path, content),
    append_file: async (file_path, content) => await fs.appendFile(file_path, content),
    with_file_lock: async (_lock_path, action) => await action(),
    run_file_action: async () => { throw new Error("not used"); },
    run_search_action: async () => { throw new Error("not used"); },
  };
}

/** 创建一个 Store 与它的临时根目录。 */
async function create_store() {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-group-session-"));
  const store = new LocalGroupSessionStore({
    files: create_files(),
    storage_root_path: root_path,
    group_id: "group-1",
  });
  return { store, root_path };
}

/** 建一个活动区的 GroupSession 并写入一条消息，返回它的 id。 */
async function create_session(store, session_id) {
  const session = store.session(session_id);
  await session.initialize();
  return session_id;
}

/** 两个区在磁盘上的实际位置。 */
function area_paths(root_path, session_id) {
  return {
    active: path.join(root_path, "sessions", encodeURIComponent(session_id)),
    archived: path.join(root_path, "archived-sessions", encodeURIComponent(session_id)),
  };
}

test("归档把群聊从活动区搬到归档区", async () => {
  const { store, root_path } = await create_store();
  const session_id = await create_session(store, "group-session-1");

  const result = await store.archive_session(session_id);
  assert.equal(result.session_id, session_id);
  assert.ok(result.archived_at > 0, "归档结果缺少时间戳");

  // 位置变了：这正是归档的全部内容。
  const paths = area_paths(root_path, session_id);
  assert.equal(await fs.access(paths.active).then(() => true, () => false), false, "活动区仍留着已归档的目录");
  assert.equal(await fs.access(paths.archived).then(() => true, () => false), true, "归档区没有收到目录");
});

test("归档后活动列表不含它、归档列表含它", async () => {
  const { store } = await create_store();
  const session_id = await create_session(store, "group-session-1");

  assert.deepEqual((await store.list_session_metadata()).map((item) => item.session_id), [session_id]);
  assert.deepEqual(await store.list_archived_session_metadata(), []);

  await store.archive_session(session_id);

  assert.deepEqual(await store.list_session_metadata(), [], "活动列表仍含已归档的群聊");
  assert.deepEqual((await store.list_archived_session_metadata()).map((item) => item.session_id), [session_id]);
});

test("归档不改 metadata 内容，只改位置", async () => {
  const { store } = await create_store();
  const session_id = await create_session(store, "group-session-1");
  const before = await store.session(session_id).read_metadata();

  await store.archive_session(session_id);

  const after = await store.session(session_id, "archived").read_metadata();
  assert.deepEqual(after, before, "归档改动了 metadata：归档只该是位置变化");
});

test("归档不存在的群聊报错，不静默成功", async () => {
  const { store } = await create_store();
  await assert.rejects(() => store.archive_session("missing"), /not found/);
});

test("重复归档报错，不覆盖已有归档", async () => {
  const { store } = await create_store();
  const session_id = await create_session(store, "group-session-1");
  await store.archive_session(session_id);

  // 覆盖会丢掉一份真实数据，因此必须是错误而不是静默替换。
  await assert.rejects(() => store.archive_session(session_id), /already exists/);
});

test("has_session 只看活动区", async () => {
  const { store } = await create_store();
  const session_id = await create_session(store, "group-session-1");
  assert.equal(await store.has_session(session_id), true);

  await store.archive_session(session_id);
  // 归档之后它不再是「活动 Session」——否则 get() 会去活动区找一个已经搬走的目录。
  assert.equal(await store.has_session(session_id), false);
});

test("删除活动群聊不影响归档区的同名条目", async () => {
  const { store } = await create_store();
  const session_id = await create_session(store, "group-session-1");
  await store.archive_session(session_id);

  // 活动区已经空了，删它返回 false；归档区的那份必须还在。
  assert.equal(await store.remove_session(session_id), false);
  assert.deepEqual((await store.list_archived_session_metadata()).map((item) => item.session_id), [session_id]);

  // 删归档区的那份才真的删掉它。
  assert.equal(await store.remove_archived_session(session_id), true);
  assert.deepEqual(await store.list_archived_session_metadata(), []);
});

test("clean_archive 清空归档区且不动活动区", async () => {
  const { store } = await create_store();
  const archived_ids = [await create_session(store, "archived-1"), await create_session(store, "archived-2")];
  for (const session_id of archived_ids) await store.archive_session(session_id);
  const active_id = await create_session(store, "active-1");

  const result = await store.clean_archive();
  assert.deepEqual([...result.removed_session_ids].sort(), [...archived_ids].sort(), "清理结果没有列出被删的 id");
  assert.deepEqual(await store.list_archived_session_metadata(), []);
  // 活动区不受影响：清理归档不该顺手删掉正在用的群聊。
  assert.deepEqual((await store.list_session_metadata()).map((item) => item.session_id), [active_id]);
});

test("归档区不存在时清理返回空结果", async () => {
  const { store } = await create_store();
  await create_session(store, "active-1");
  // 没有任何归档时不该报错，也不该顺手建出归档目录。
  assert.deepEqual(await store.clean_archive(), { removed_session_ids: [] });
});

/**
 * `purge` 服务于「Group 被删除」。
 *
 * 没有它时删掉一个 Group 会在磁盘上留下无人认领的孤儿目录：
 * 没有入口能再访问它们，只是磁盘泄漏。归档能力加上后这一点更明显——
 * 归档区会永久积累这类数据。
 */
test("purge 删掉活动区与归档区，且不留残渣", async () => {
  const { store, root_path } = await create_store();
  const archived_id = await create_session(store, "archived-1");
  await store.archive_session(archived_id);
  await create_session(store, "active-1");

  await store.purge();

  assert.deepEqual(await store.list_session_metadata(), []);
  assert.deepEqual(await store.list_archived_session_metadata(), []);
  // 两个区目录都不在了：只删其中一个都会留下残渣。
  assert.equal(await fs.access(path.join(root_path, "sessions")).then(() => true, () => false), false);
  assert.equal(await fs.access(path.join(root_path, "archived-sessions")).then(() => true, () => false), false);
});

test("purge 在没有任何数据时也不报错", async () => {
  const { store } = await create_store();
  // 幂等：删一个从没聊过的 Group 不该失败。
  await store.purge();
  assert.deepEqual(await store.list_session_metadata(), []);
});
