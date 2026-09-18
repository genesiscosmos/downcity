/** Power Profile 到唯一 Config 的一次性文件迁移测试。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parse } from "smol-toml";

const script_path = path.resolve("scripts/migrate-power-config-v2.mjs");

/** 写入测试使用的旧 Power 配置。 */
async function write_legacy_config(root_path, power_id, content) {
  const power_path = path.join(root_path, "powers", power_id);
  await fs.mkdir(power_path, { recursive: true });
  await fs.writeFile(path.join(power_path, "config.toml"), content, { mode: 0o600 });
}

test("迁移脚本选择 default 或唯一 Profile 并清理 Agent 引用", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-power-migrate-"));
  try {
    await write_legacy_config(root_path, "chat", "schema_version = 1\n[profiles.default]\ntoken = \"secret\"\n[profiles.other]\ntoken = \"other\"\n");
    await write_legacy_config(root_path, "web", "schema_version = 1\n[profiles.work]\ncdp_url = \"http://localhost:9222\"\n");
    const agent_path = path.join(root_path, "agents", "developer");
    await fs.mkdir(agent_path, { recursive: true });
    await fs.writeFile(path.join(agent_path, "agent.json"), JSON.stringify({
      schema_version: 2,
      agent_id: "developer",
      powers: { chat: { profile: "default" } },
    }), { mode: 0o600 });

    const result = spawnSync(process.execPath, [script_path, root_path], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes("secret"), false);
    const chat = parse(await fs.readFile(path.join(root_path, "powers", "chat", "config.toml"), "utf8"));
    const web = parse(await fs.readFile(path.join(root_path, "powers", "web", "config.toml"), "utf8"));
    assert.deepEqual(chat, { schema_version: 2, config: { token: "secret" } });
    assert.deepEqual(web, { schema_version: 2, config: { cdp_url: "http://localhost:9222" } });
    assert.equal((await fs.readFile(path.join(root_path, "powers", "chat", "config.toml.profiles-v1.bak"), "utf8")).includes("profiles.default"), true);
    const agent = JSON.parse(await fs.readFile(path.join(agent_path, "agent.json"), "utf8"));
    assert.equal("powers" in agent, false);
    assert.equal((await fs.stat(path.join(agent_path, "agent.json.powers-v1.bak"))).mode & 0o777, 0o600);
  } finally {
    await fs.rm(root_path, { recursive: true, force: true });
  }
});

test("迁移脚本遇到多个非 default Profile 时不修改任何文件", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-power-migrate-"));
  const content = "schema_version = 1\n[profiles.first]\nvalue = 1\n[profiles.second]\nvalue = 2\n";
  try {
    await write_legacy_config(root_path, "ambiguous", content);
    const result = spawnSync(process.execPath, [script_path, root_path], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.equal(await fs.readFile(path.join(root_path, "powers", "ambiguous", "config.toml"), "utf8"), content);
    await assert.rejects(fs.access(path.join(root_path, "powers", "ambiguous", "config.toml.profiles-v1.bak")));
  } finally {
    await fs.rm(root_path, { recursive: true, force: true });
  }
});

test("迁移脚本遇到既有备份时不修改其他候选文件", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-power-migrate-"));
  const first_content = "schema_version = 1\n[profiles.default]\nvalue = 1\n";
  const second_content = "schema_version = 1\n[profiles.default]\nvalue = 2\n";
  try {
    await write_legacy_config(root_path, "first", first_content);
    await write_legacy_config(root_path, "second", second_content);
    await fs.writeFile(
      path.join(root_path, "powers", "second", "config.toml.profiles-v1.bak"),
      "existing backup",
      { mode: 0o600 },
    );

    const result = spawnSync(process.execPath, [script_path, root_path], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.equal(
      await fs.readFile(path.join(root_path, "powers", "first", "config.toml"), "utf8"),
      first_content,
    );
    assert.equal(
      await fs.readFile(path.join(root_path, "powers", "second", "config.toml"), "utf8"),
      second_content,
    );
    await assert.rejects(
      fs.access(path.join(root_path, "powers", "first", "config.toml.profiles-v1.bak")),
    );
  } finally {
    await fs.rm(root_path, { recursive: true, force: true });
  }
});
