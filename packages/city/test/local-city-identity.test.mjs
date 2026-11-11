/** 本地 City 来源标识回归：root 持久性、并发首次创建及损坏拒绝，全部使用临时目录。 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { resolve_local_city_id } from "../src/local/runtime/LocalCityIdentity.ts";

const exec_file = promisify(execFile);

test("宿主 root 重启保持来源，不同 root 不共享来源，损坏文件不重分配", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "downcity-city-source-"));
  try {
    const first_root = path.join(root, "first");
    const second_root = path.join(root, "second");
    const first = resolve_local_city_id(first_root);
    assert.equal(resolve_local_city_id(first_root), first);
    assert.notEqual(resolve_local_city_id(second_root), first);
    const module_url = new URL("../src/local/runtime/LocalCityIdentity.ts", import.meta.url).href;
    const script = `import { resolve_local_city_id } from ${JSON.stringify(module_url)}; process.stdout.write(resolve_local_city_id(process.argv[1]));`;
    const restarted = await exec_file(process.execPath, ["--input-type=module", "-e", script, first_root]);
    assert.equal(restarted.stdout, first);
    const concurrent_root = path.join(root, "concurrent");
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => exec_file(process.execPath, ["--input-type=module", "-e", script, concurrent_root])));
    assert.equal(new Set(concurrent.map((result) => result.stdout)).size, 1);
    assert.equal((await readFile(path.join(concurrent_root, "city-id"), "utf8")).trim(), concurrent[0].stdout);
    await writeFile(path.join(first_root, "city-id"), "invalid/source");
    assert.throws(() => resolve_local_city_id(first_root), /Invalid persisted City ID/u);
    assert.equal(await readFile(path.join(first_root, "city-id"), "utf8"), "invalid/source");
  } finally { await rm(root, { recursive: true, force: true }); }
});
