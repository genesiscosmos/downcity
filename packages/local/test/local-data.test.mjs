/** 验证本地数据库 Adapter 与产品 Repository 的职责边界。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AgentRepository,
  ensure_local_schema,
  LocalCrypto,
  LocalDatabase,
  SecureSettingRepository,
  WorkspaceRepository,
} from "../bin/index.js";

/** 创建临时本地数据依赖。 */
async function create_local_data() {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-local-data-"));
  const database = new LocalDatabase({ filename: path.join(root_path, "downcity.db") });
  return { root_path, database };
}

test("LocalDatabase 不会隐式创建产品业务表", async () => {
  const { root_path, database } = await create_local_data();
  try {
    const before = database.query({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    });
    assert.deepEqual(before.rows, []);

    ensure_local_schema(database);
    const after = database.query({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    });
    assert.equal(after.rows.some((row) => row.name === "managed_agents"), true);
    assert.equal(after.rows.some((row) => row.name === "workspaces"), true);
  } finally {
    database.close();
    await fs.rm(root_path, { recursive: true, force: true });
  }
});

test("AgentRepository 与 WorkspaceRepository 独立维护产品配置", async () => {
  const { root_path, database } = await create_local_data();
  try {
    ensure_local_schema(database);
    const crypto_adapter = new LocalCrypto(root_path);
    const workspaces = new WorkspaceRepository(database, crypto_adapter);
    const agents = new AgentRepository(database, crypto_adapter, workspaces);

    const workspace = workspaces.ensure({ workspace_path: path.join(root_path, "project") });
    const agent = agents.create({
      agent_id: "Lucas Whitman",
      workspace_id: workspace.workspace_id,
      execution: { type: "api", model_id: "model-test" },
    });

    assert.equal(agents.get("lucas_whitman")?.workspace_id, workspace.workspace_id);
    assert.equal(workspaces.get(workspace.workspace_id)?.workspace_path, workspace.workspace_path);
    assert.deepEqual(agents.list().map((item) => item.agent_id), ["lucas_whitman"]);
  } finally {
    database.close();
    await fs.rm(root_path, { recursive: true, force: true });
  }
});
