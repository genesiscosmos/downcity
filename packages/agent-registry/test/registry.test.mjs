/** Agent 与 Workspace Registry 的共享持久化行为测试。 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs_sync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

/** 使用 Registry 兼容格式加密旧记录。 */
function encode_legacy_record(record, key_value) {
  const key = crypto.createHash("sha256").update(key_value, "utf8").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(record), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

test("CLI 与 Desktop 可通过同一数据库独立管理 Agent 和 Workspace", async () => {
  const platform_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-registry-"));
  process.env.DC_PLATFORM_ROOT = platform_root;
  const registry = await import("../bin/index.js");
  try {
    const created = registry.create_agent_registry_record({
      agent_id: "Desktop Agent",
      version: "1.0.0",
      execution: { type: "api", model_id: "primary" },
      workspace_path: platform_root,
    });
    assert.equal(created.agent_id, "desktop_agent");
    assert.equal("workspace_path" in created, false);
    assert.equal(registry.list_agent_registry_records().length, 1);
    assert.equal("workspace_path" in registry.get_agent_registry_record(created.agent_id), false);

    const workspace = registry.create_workspace_registry_record({
      workspace_path: platform_root,
      name: "Test Workspace",
    });
    assert.equal(workspace.workspace_path, platform_root);
    assert.equal(workspace.name, "Test Workspace");
    assert.equal(
      registry.create_workspace_registry_record({ workspace_path: platform_root }).workspace_id,
      workspace.workspace_id,
    );

    const updated = registry.update_agent_registry_record({
      agent_id: created.agent_id,
      llm: { log_messages: true },
    });
    assert.deepEqual(updated.llm, { log_messages: true });
    const saved = registry.save_agent_registry_record({
      ...updated,
      workspace_path: platform_root,
    });
    assert.equal("workspace_path" in saved, false);
    registry.remove_agent_registry_record(created.agent_id);
    assert.deepEqual(registry.list_agent_registry_records(), []);
    assert.equal(registry.list_workspace_registry_records().length, 1);
    registry.remove_workspace_registry_record(workspace.workspace_id);
    assert.deepEqual(registry.list_workspace_registry_records(), []);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    await fs.rm(platform_root, { recursive: true, force: true });
  }
});

test("旧 Agent Workspace 强绑定迁移为两个独立记录", async () => {
  const platform_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-registry-migration-"));
  const workspace_path = path.join(platform_root, "project");
  const key_value = "agent-workspace-migration-test";
  process.env.DC_PLATFORM_ROOT = platform_root;
  process.env.DC_MODEL_DB_KEY = key_value;
  await fs.mkdir(workspace_path);
  try {
    const database = new DatabaseSync(path.join(platform_root, "downcity.db"));
    database.exec(`
      CREATE TABLE managed_agents (
        agent_id TEXT PRIMARY KEY NOT NULL,
        workspace_path TEXT NOT NULL,
        config_encrypted TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX managed_agents_workspace_path_idx
      ON managed_agents(workspace_path);
    `);
    const created_at = "2026-01-01T00:00:00.000Z";
    database.prepare(`
      INSERT INTO managed_agents (
        agent_id, workspace_path, config_encrypted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?);
    `).run(
      "legacy_agent",
      workspace_path,
      encode_legacy_record({
        agent_id: "legacy_agent",
        workspace_path,
        version: "1.0.0",
        execution: { type: "api", model_id: "primary" },
        created_at,
        updated_at: created_at,
      }, key_value),
      created_at,
      created_at,
    );
    database.close();

    const session_path = path.join(
      workspace_path,
      ".downcity",
      "agents",
      "legacy_agent",
      "sessions",
      "session_one",
    );
    await fs.mkdir(session_path, { recursive: true });
    await fs.writeFile(path.join(session_path, "marker.txt"), "kept");

    const registry = await import("../bin/index.js");
    const agent = registry.get_agent_registry_record("legacy_agent");
    const workspaces = registry.list_workspace_registry_records();
    assert.equal(agent.agent_id, "legacy_agent");
    assert.equal("workspace_path" in agent, false);
    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0].workspace_path, workspace_path);
    assert.equal(fs_sync.existsSync(path.join(session_path, "marker.txt")), true);

    const poisoned_workspace = {
      ...workspaces[0],
      agent_id: "legacy_agent",
    };
    const poison_database = new DatabaseSync(path.join(platform_root, "downcity.db"));
    poison_database.prepare(`
      UPDATE workspaces SET config_encrypted = ? WHERE workspace_id = ?;
    `).run(
      encode_legacy_record(poisoned_workspace, key_value),
      workspaces[0].workspace_id,
    );
    poison_database.close();
    const normalized_workspace = registry.get_workspace_registry_record(workspaces[0].workspace_id);
    assert.equal("agent_id" in normalized_workspace, false);
    const updated_workspace = registry.update_workspace_registry_record({
      workspace_id: workspaces[0].workspace_id,
      name: "Migrated Workspace",
    });
    assert.equal("agent_id" in updated_workspace, false);

    const migrated_database = new DatabaseSync(path.join(platform_root, "downcity.db"));
    const agent_columns = migrated_database.prepare(
      "PRAGMA table_info(managed_agents);",
    ).all().map((column) => column.name);
    migrated_database.close();
    assert.equal(agent_columns.includes("workspace_path"), false);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    delete process.env.DC_MODEL_DB_KEY;
    await fs.rm(platform_root, { recursive: true, force: true });
  }
});
