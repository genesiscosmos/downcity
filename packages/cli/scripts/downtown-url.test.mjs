/** Downtown CLI 只输入地址：从真实命令入口验证稳定身份、改名和移除恢复。 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { create_downtown_id } from "@downcity/city";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/downcity.js", import.meta.url));

test("登记、改名、移除和恢复只需 URL，普通输出隐藏内部身份", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "downtown-url-"));
  const environment = { ...process.env, DOWNCITY_DOWNTOWN_URL: "", DOWNCITY_USER_TOKEN: "" };
  const call = async (...args) => (await execute(process.execPath, [cli, "downtown", ...args, "--root", root], { env: environment })).stdout;
  try {
    const first = await call("add", "HTTPS://EXAMPLE.COM:443/", "--name", "Team");
    assert.equal(first.includes("downtown_id"), false);
    assert.equal(first.includes("auth_scope_id"), false);
    const list = JSON.parse(await call("list", "--json")).items;
    assert.equal(list.length, 1);
    assert.equal(list[0].downtown_id, create_downtown_id("https://example.com"));
    await call("rename", "https://example.com", "Renamed");
    await call("remove", "https://example.com/");
    assert.deepEqual(JSON.parse(await call("list", "--json")).items, []);
    await call("restore", "https://example.com");
    const restored = JSON.parse(await call("list", "--json")).items;
    assert.equal(restored[0].name, "Renamed");
    assert.equal(restored[0].downtown_id, list[0].downtown_id);
    const help = (await execute(process.execPath, [cli, "downtown", "call", "--help"], { env: environment })).stdout;
    assert.match(help, /--downtown <url>/);
    assert.doesNotMatch(help, /--connection/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
