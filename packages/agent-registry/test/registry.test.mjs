/** Agent Registry 的共享持久化行为测试。 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("CLI 与 Desktop 可通过同一数据库完成 Agent CRUD", async () => {
  const platform_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-registry-"));
  process.env.DC_PLATFORM_ROOT = platform_root;
  const registry = await import("../bin/index.js");
  try {
    const created = registry.create_agent_registry_record({
      agent_id: "Desktop Agent",
      workspace_path: platform_root,
      version: "1.0.0",
      execution: { type: "api", model_id: "primary" },
    });
    assert.equal(created.agent_id, "desktop_agent");
    assert.equal(registry.list_agent_registry_records().length, 1);
    const updated = registry.update_agent_registry_record({
      agent_id: created.agent_id,
      llm: { log_messages: true },
    });
    assert.deepEqual(updated.llm, { log_messages: true });
    registry.remove_agent_registry_record(created.agent_id);
    assert.deepEqual(registry.list_agent_registry_records(), []);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    await fs.rm(platform_root, { recursive: true, force: true });
  }
});
