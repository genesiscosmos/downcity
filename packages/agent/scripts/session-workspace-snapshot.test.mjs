/**
 * @file 验证 Session shadow Git 快照不会污染用户仓库，并只汇总当前 Turn 的变化。
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { GitSessionWorkspaceSnapshot } from "../bin/session/snapshot/SessionWorkspaceSnapshot.js";

const exec_file = promisify(execFile);

/** 在指定测试仓库执行 Git。 */
async function git(cwd, args) {
  const result = await exec_file("git", args, { cwd, encoding: "utf8" });
  return result.stdout;
}

/** 创建包含两个已提交文件的最小 Git 仓库。 */
async function create_repository() {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-snapshot-repo-"));
  await git(root_path, ["init", "--quiet"]);
  await fs.writeFile(path.join(root_path, "edited.txt"), "base\n", "utf8");
  await fs.writeFile(path.join(root_path, "deleted.txt"), "gone\n", "utf8");
  await git(root_path, ["add", "--all"]);
  await git(root_path, [
    "-c", "user.name=Downcity Test",
    "-c", "user.email=test@downcity.local",
    "commit", "--quiet", "-m", "initial",
  ]);
  return root_path;
}

test("shadow snapshot 只记录首尾状态差异且不修改用户 index", async (context) => {
  const root_path = await create_repository();
  const snapshot_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-snapshot-data-"));
  context.after(async () => {
    await Promise.all([
      fs.rm(root_path, { recursive: true, force: true }),
      fs.rm(snapshot_path, { recursive: true, force: true }),
    ]);
  });

  // 首次 capture 前已经存在的脏改动属于基线，不应被归入当前 Turn。
  await fs.writeFile(path.join(root_path, "edited.txt"), "base\npreexisting\n", "utf8");
  const cached_before = await git(root_path, ["diff", "--cached", "--binary"]);
  const snapshot = new GitSessionWorkspaceSnapshot(root_path, snapshot_path);
  const before = await snapshot.capture();

  await fs.writeFile(path.join(root_path, "edited.txt"), "base\npreexisting\nturn\n", "utf8");
  await fs.writeFile(path.join(root_path, "added.txt"), "one\ntwo\n", "utf8");
  await fs.rm(path.join(root_path, "deleted.txt"));
  const after = await snapshot.capture();
  const diffs = await snapshot.diff(before, after);
  const cached_after = await git(root_path, ["diff", "--cached", "--binary"]);

  assert.equal(cached_after, cached_before);
  assert.deepEqual(diffs.map((item) => [item.file, item.status]), [
    ["added.txt", "added"],
    ["deleted.txt", "deleted"],
    ["edited.txt", "modified"],
  ]);
  assert.deepEqual(diffs.map((item) => [item.additions, item.deletions]), [
    [2, 0],
    [0, 1],
    [1, 0],
  ]);
  assert.match(diffs.find((item) => item.file === "edited.txt").patch, /\+turn/);
  assert.doesNotMatch(diffs.find((item) => item.file === "edited.txt").patch, /\+preexisting/);
});

test("非 Git Workspace 不启用 snapshot", async (context) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-snapshot-non-git-"));
  const snapshot_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-snapshot-data-"));
  context.after(async () => {
    await Promise.all([
      fs.rm(root_path, { recursive: true, force: true }),
      fs.rm(snapshot_path, { recursive: true, force: true }),
    ]);
  });
  const snapshot = new GitSessionWorkspaceSnapshot(root_path, snapshot_path);
  assert.equal(await snapshot.capture(), undefined);
});

test("仓库子目录 Workspace 不汇总范围外改动", async (context) => {
  const root_path = await create_repository();
  const workspace_path = path.join(root_path, "workspace");
  const snapshot_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-snapshot-data-"));
  await fs.mkdir(workspace_path);
  await fs.writeFile(path.join(workspace_path, "inside.txt"), "before\n", "utf8");
  await git(root_path, ["add", "--all"]);
  await git(root_path, [
    "-c", "user.name=Downcity Test",
    "-c", "user.email=test@downcity.local",
    "commit", "--quiet", "-m", "workspace",
  ]);
  context.after(async () => {
    await Promise.all([
      fs.rm(root_path, { recursive: true, force: true }),
      fs.rm(snapshot_path, { recursive: true, force: true }),
    ]);
  });
  const snapshot = new GitSessionWorkspaceSnapshot(workspace_path, snapshot_path);
  const before = await snapshot.capture();
  await fs.writeFile(path.join(workspace_path, "inside.txt"), "after\n", "utf8");
  await fs.writeFile(path.join(root_path, "edited.txt"), "outside\n", "utf8");
  const after = await snapshot.capture();
  const diffs = await snapshot.diff(before, after);
  assert.deepEqual(diffs.map((item) => item.file), ["workspace/inside.txt"]);
});
