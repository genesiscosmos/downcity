/** @file 验证 Shell core 对宿主只读目录的统一安全校验。 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolve_sandbox_policy } from "@downcity/workspace/shell/sandbox/SandboxPolicy.js";
import { test_sandbox } from "./TestSandbox.mjs";

async function create_fixture() {
  const fixture_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-policy-"));
  const project_root = path.join(fixture_root, "project");
  const tool_root = path.join(fixture_root, "tools", "officecli", "v1");
  await fs.mkdir(project_root, { recursive: true });
  await fs.mkdir(tool_root, { recursive: true, mode: 0o755 });
  await fs.chmod(tool_root, 0o755);
  return { fixture_root, project_root, tool_root };
}

test("host tool directory enters read-only policy only", async () => {
  const fixture = await create_fixture();
  try {
    const policy = await resolve_sandbox_policy({
      sandbox: test_sandbox,
      rootPath: fixture.project_root,
      dataPath: path.join(fixture.fixture_root, "agent-workspace-data"),
      safe_read_only_paths: [fixture.tool_root],
    }, {});
    const real_tool_root = await fs.realpath(fixture.tool_root);
    assert.equal(policy.read_only_paths.includes(real_tool_root), true);
    assert.deepEqual(policy.host_read_only_paths, [real_tool_root]);
    assert.equal(policy.read_write_paths.includes(real_tool_root), false);
    assert.equal(policy.backend, "test-sandbox");
  } finally {
    await fs.rm(fixture.fixture_root, { recursive: true, force: true });
  }
});

test("host tool directory cannot overlap workspace writable root", async () => {
  const fixture = await create_fixture();
  try {
    const nested_tool_root = path.join(fixture.project_root, "tools");
    await fs.mkdir(nested_tool_root, { recursive: true, mode: 0o755 });
    await assert.rejects(resolve_sandbox_policy({
      sandbox: test_sandbox,
      rootPath: fixture.project_root,
      dataPath: path.join(fixture.fixture_root, "agent-workspace-data"),
      safe_read_only_paths: [nested_tool_root],
    }, {}), /overlaps a writable path/);
  } finally {
    await fs.rm(fixture.fixture_root, { recursive: true, force: true });
  }
});

test("group or world writable host tool directory is rejected", async () => {
  const fixture = await create_fixture();
  try {
    await fs.chmod(fixture.tool_root, 0o777);
    await assert.rejects(resolve_sandbox_policy({
      sandbox: test_sandbox,
      rootPath: fixture.project_root,
      dataPath: path.join(fixture.fixture_root, "agent-workspace-data"),
      safe_read_only_paths: [fixture.tool_root],
    }, {}), /must not be group\/world writable/);
  } finally {
    await fs.rm(fixture.fixture_root, { recursive: true, force: true });
  }
});
