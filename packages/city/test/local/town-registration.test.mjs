/** Town 登记持久化回归：一次性迁移保留认证事实，地址身份稳定且变更隔离。 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { create_downtown_id } from "../../bin/index.js";
import { LocalDatabase, LocalSettingRepository, TownConnectionRepository, ensure_local_schema } from "../../bin/local/index.js";

/** 临时数据库只由当前测试拥有，不读取真实用户配置。 */
async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "town-registration-"));
  const database = new LocalDatabase({ filename: path.join(root, "downcity.db") });
  try { ensure_local_schema(database); await run(new TownConnectionRepository(database), new LocalSettingRepository(database)); }
  finally { database.close(); await rm(root, { recursive: true, force: true }); }
}

test("规范地址重复登记和改名不改变 Downtown ID，另一个地址使用新身份", async () => fixture(async (repository) => {
  const first = repository.add({ url: "HTTPS://EXAMPLE.COM:443/", name: "Name" });
  assert.equal(first.downtown_id, create_downtown_id("https://example.com"));
  assert.equal(repository.add({ url: "https://example.com" }).downtown_id, first.downtown_id);
  assert.equal(repository.rename(first.downtown_id, "Renamed").downtown_id, first.downtown_id);
  const second = repository.add({ url: "https://other.example" });
  assert.notEqual(second.downtown_id, first.downtown_id);
  assert.deepEqual(repository.accounts(second.downtown_id), []);
  repository.remove(first.downtown_id);
  assert.throws(() => repository.add({ url: first.url }), /Restore/);
  assert.equal(repository.restore(first.downtown_id).name, "Renamed");
}));

test("旧随机 ID 转为地址身份，保留账号、授权 scope 和凭据且迁移幂等", async () => fixture(async (repository, settings) => {
  const legacy = { version: 1, connections: { random: {
    connection_id: "random", name: "Saved", url: "https://example.com/", status: "active", revision: 7,
    source: "remote", account_id: "account", auth_scope_id: "scope", created_at: "old", updated_at: "now",
  } }, accounts: { account: {
    account_id: "account", connection_id: "random", url: "https://example.com/", user_id: "user",
    auth_scope_id: "scope", user_token: "test-token", session_id: "session", last_used_at: 100,
  } } };
  settings.set("town.connections.v1", legacy);
  repository.migrate();
  const id = create_downtown_id("https://example.com");
  assert.equal(repository.list()[0].downtown_id, id);
  assert.equal(repository.credentials(id).user_token, "test-token");
  assert.equal(repository.credentials(id).auth_scope_id, "scope");
  assert.equal(repository.accounts(id)[0].selected, true);
  assert.equal(repository.accounts(id)[0].session_id, "session");
  assert.equal("user_token" in repository.accounts(id)[0], false);
  const state = settings.get("town.connections.v2");
  repository.migrate();
  assert.deepEqual(settings.get("town.connections.v2"), state);
  assert.deepEqual(settings.get("town.registration.v1.archive"), legacy);
  assert.equal("connection_id" in state.connections[id], false);
}));
