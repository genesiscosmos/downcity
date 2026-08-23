/** 验证 CLI 与 Desktop 共用的 City 宿主所有权协议。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  create_city_host_instance_id,
  get_city_host_state_path,
  read_city_host_state,
  register_city_host,
  unregister_city_host,
} from "../bin/index.js";

test("City 宿主登记拒绝覆盖活跃实例并按 instance_id 注销", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-host-"));
  const previous_root_path = process.env.DC_PLATFORM_ROOT;
  process.env.DC_PLATFORM_ROOT = root_path;
  const first_instance_id = create_city_host_instance_id();
  const second_instance_id = create_city_host_instance_id();
  try {
    await register_city_host({
      owner: "cli",
      pid: process.pid,
      instance_id: first_instance_id,
      started_at: new Date().toISOString(),
    });
    assert.equal((await read_city_host_state())?.instance_id, first_instance_id);
    await assert.rejects(register_city_host({
      owner: "desktop",
      pid: process.pid,
      instance_id: second_instance_id,
      started_at: new Date().toISOString(),
    }), /already owned by cli/u);

    await unregister_city_host(second_instance_id);
    assert.equal((await read_city_host_state())?.instance_id, first_instance_id);
    await unregister_city_host(first_instance_id);
    assert.equal(await read_city_host_state(), null);
  } finally {
    if (previous_root_path === undefined) delete process.env.DC_PLATFORM_ROOT;
    else process.env.DC_PLATFORM_ROOT = previous_root_path;
    await fs.rm(root_path, { recursive: true, force: true });
  }
});

test("City 宿主读取会清理已退出进程留下的状态", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-host-stale-"));
  const previous_root_path = process.env.DC_PLATFORM_ROOT;
  process.env.DC_PLATFORM_ROOT = root_path;
  try {
    const file_path = get_city_host_state_path();
    await fs.mkdir(path.dirname(file_path), { recursive: true });
    await fs.writeFile(file_path, JSON.stringify({
      owner: "desktop",
      pid: 2_147_483_647,
      instance_id: create_city_host_instance_id(),
      started_at: new Date().toISOString(),
    }), "utf8");
    assert.equal(await read_city_host_state(), null);
    await assert.rejects(fs.access(file_path));
  } finally {
    if (previous_root_path === undefined) delete process.env.DC_PLATFORM_ROOT;
    else process.env.DC_PLATFORM_ROOT = previous_root_path;
    await fs.rm(root_path, { recursive: true, force: true });
  }
});
