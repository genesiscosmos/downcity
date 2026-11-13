/** 真实临时根验证未初始化集合的只读语义、首次写入可见性与错误边界。 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID as random_uuid } from "node:crypto";
import test from "node:test";
import { AgentSessionBrowser } from "../bin/session/storage/agent-db/AgentSessionBrowser.js";
import { acquire_agent_session_storage } from "../bin/session/storage/agent-db/AgentSessionRuntime.js";

/** 每项独立根和浏览对象，失败也释放租约并清理临时数据。 */
async function with_browser(run) {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "session-browser-empty-"));
  const browser = new AgentSessionBrowser({ agent_id: "test", storage_root_path: root_path });
  try { await run(browser, root_path); }
  finally { await browser.dispose(); await fs.rm(root_path, { recursive: true, force: true }); }
}

test("无数据库的现存 Agent 根：活动、归档和分类为空，读取不产生文件", async () => {
  await with_browser(async (browser, root_path) => {
    await fs.writeFile(path.join(root_path, "agent.json"), "{}");
    for (const archived of [false, true]) {
      const page = await browser.list({ workspace_id: "project", limit: 30 }, archived);
      assert.deepEqual(page.items, []);
      assert.equal(page.total, 0);
      assert.equal(page.has_more, false);
      assert.equal(page.next_cursor ?? null, null);
      assert.deepEqual(await browser.categories(archived), []);
    }
    assert.deepEqual(await fs.readdir(root_path), ["agent.json"]);
  });
});

test("空结果不缓存，首次真实写入后同一浏览对象立即可读", async () => {
  await with_browser(async (browser, root_path) => {
    assert.equal((await browser.list()).total, 0);
    assert.deepEqual(await browser.categories(), []);
    const writer = await acquire_agent_session_storage({ agent_id: "test", database_path: path.join(root_path, "sessions.db"), allow_create: true }, false);
    const storage_id = random_uuid();
    try {
      await writer.write("collection", { command: "create", operation_id: random_uuid(), input: {
        storage_id, session_id: "first", origin: { category: "work", type: "work" },
        workspace_id: "project", timezone: "UTC", created_at: 1,
      } });
      const page = await browser.list({ workspace_id: "project" });
      assert.equal(page.total, 1);
      assert.equal(page.items[0].storage_id, storage_id);
      assert.deepEqual(await browser.categories(), ["work"]);
      assert.equal((await browser.get("first")).storage_id, storage_id);
    } finally { await writer.release(); }
  });
});

test("精确记录、配置及带游标后续页仍报告缺失存储", async () => {
  await with_browser(async browser => {
    const storage_id = random_uuid();
    for (const read of [() => browser.get("saved"), () => browser.get_record(storage_id),
      () => browser.get_archived({ storage_id }), () => browser.configuration(storage_id),
      () => browser.list({ cursor: "previous-page" }), () => browser.list({ cursor: "previous-page" }, true)]) {
      await assert.rejects(read(), /session_storage_not_found/);
    }
    assert.equal((await browser.list()).total, 0, "精确读取失败不污染后续集合查询");
  });
});

for (const partition of ["sessions", "archived-sessions"]) {
  test(`${partition} 旧分区存在时保持迁移错误`, async () => {
    await with_browser(async (browser, root_path) => {
      await fs.mkdir(path.join(root_path, partition));
      await assert.rejects(browser.list(), /session_migration_required/);
      await assert.rejects(browser.list({}, true), /session_migration_required/);
      await assert.rejects(browser.categories(), /session_migration_required/);
      assert.deepEqual(await fs.readdir(root_path), [partition]);
    });
  });
}

test("Agent 根缺失或不是目录时明确失败", async () => {
  await with_browser(async (_browser, root_path) => {
    const missing = new AgentSessionBrowser({ agent_id: "test", storage_root_path: path.join(root_path, "missing") });
    const file_path = path.join(root_path, "file");
    await fs.writeFile(file_path, "not a directory");
    const invalid = new AgentSessionBrowser({ agent_id: "test", storage_root_path: file_path });
    try {
      await assert.rejects(missing.list(), /session_storage_not_found/);
      await assert.rejects(missing.categories(), /session_storage_not_found/);
      await assert.rejects(invalid.list());
      await assert.rejects(invalid.categories());
    } finally { await missing.dispose(); await invalid.dispose(); }
  });
});

test("权限错误不转换为空集合", async context => {
  await with_browser(async (browser, root_path) => {
    const stat = fs.stat.bind(fs);
    context.mock.method(fs, "stat", async (file_path, ...options) => {
      if (file_path === path.join(root_path, "sessions.db")) throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      return stat(file_path, ...options);
    });
    try {
      await assert.rejects(browser.list(), { code: "EACCES" });
      await assert.rejects(browser.categories(), { code: "EACCES" });
    } finally { context.mock.restoreAll(); }
  });
});

test("损坏数据库保持存储错误，读取不改写文件", async () => {
  await with_browser(async (browser, root_path) => {
    const database_path = path.join(root_path, "sessions.db");
    const contents = "invalid sqlite data".repeat(100);
    await fs.writeFile(database_path, contents);
    await assert.rejects(browser.list(), /session_storage_not_database/);
    await assert.rejects(browser.categories(), /session_storage_not_database/);
    assert.equal(await fs.readFile(database_path, "utf8"), contents);
  });
});

test("宿主注入租约的错误保持原样，不按磁盘空根推断为空集合", async () => {
  await with_browser(async (_browser, root_path) => {
    const browser = new AgentSessionBrowser({ agent_id: "test", storage_root_path: root_path,
      acquire_read_lease: async () => { throw new Error("session_storage_not_found"); } });
    try {
      await assert.rejects(browser.list(), /session_storage_not_found/);
      await assert.rejects(browser.categories(), /session_storage_not_found/);
    } finally { await browser.dispose(); }
  });
});

test("空根仍校验分页参数，释放后拒绝集合读取", async () => {
  await with_browser(async browser => {
    for (const limit of [0, 201, 1.5, NaN]) await assert.rejects(browser.list({ limit }), /session_list_limit_invalid/);
    await browser.dispose();
    await assert.rejects(browser.list(), /session_storage_lease_released/);
    await assert.rejects(browser.categories(), /session_storage_lease_released/);
  });
});
