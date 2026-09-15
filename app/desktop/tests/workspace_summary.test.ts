/** Desktop Workspace 摘要的 README 失败语义测试。 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  is_unavailable_workspace_readme_error,
  read_workspace_readme,
  to_desktop_workspace_summary,
} from "../src/main/agent/WorkspaceSummary.ts";

test("Workspace README 正常可读时返回原始内容", async () => {
  const workspace_path = await mkdtemp(path.join(os.tmpdir(), "downcity-workspace-summary-"));
  try {
    await writeFile(path.join(workspace_path, "README.md"), "# Workspace\n", "utf8");
    assert.equal(await read_workspace_readme(workspace_path), "# Workspace\n");
  } finally {
    await rm(workspace_path, { recursive: true, force: true });
  }
});

test("Workspace README 不存在时降级为空内容", async () => {
  const workspace_path = await mkdtemp(path.join(os.tmpdir(), "downcity-workspace-summary-"));
  try {
    assert.equal(await read_workspace_readme(workspace_path), "");
  } finally {
    await rm(workspace_path, { recursive: true, force: true });
  }
});

test("README 不可用时仍保留完整 Workspace 摘要", async () => {
  const workspace_path = await mkdtemp(path.join(os.tmpdir(), "downcity-workspace-summary-"));
  try {
    assert.deepEqual(await to_desktop_workspace_summary({
      workspace_id: "workspace-id",
      workspace_path,
      name: "Workspace",
      created_at: "2026-09-14T00:00:00.000Z",
      updated_at: "2026-09-14T01:00:00.000Z",
    }), {
      workspace_id: "workspace-id",
      workspace_path,
      name: "Workspace",
      readme: "",
      created_at: "2026-09-14T00:00:00.000Z",
      updated_at: "2026-09-14T01:00:00.000Z",
    });
  } finally {
    await rm(workspace_path, { recursive: true, force: true });
  }
});

test("只有 README 缺失或权限拒绝属于可降级错误", () => {
  for (const code of ["ENOENT", "EACCES", "EPERM"]) {
    assert.equal(is_unavailable_workspace_readme_error(Object.assign(new Error(code), { code })), true);
  }
  assert.equal(is_unavailable_workspace_readme_error(Object.assign(new Error("I/O failed"), { code: "EIO" })), false);
  assert.equal(is_unavailable_workspace_readme_error(new Error("unknown")), false);
});
