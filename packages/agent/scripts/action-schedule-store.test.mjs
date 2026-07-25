/**
 * @file 验证 ActionScheduleStore 通过 Workspace FileSystem 持久化异步事件流。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ActionScheduleStore, Workspace } from "../bin/index.js";

test("ActionScheduleStore persists through Workspace FileSystem", async (t) => {
  const workspace_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-action-schedule-"),
  );
  t.after(async () => {
    await fs.rm(workspace_path, { recursive: true, force: true });
  });
  const workspace = new Workspace({ path: workspace_path });
  const store = new ActionScheduleStore(workspace.files);

  const created = await store.createJob({
    pluginName: "demo",
    actionName: "run",
    payload: { value: 1 },
    runAtMs: Date.now() - 1,
  });
  assert.equal((await store.listDuePendingJobs(Date.now())).length, 1);
  assert.equal(await store.markJobRunning(created.id), true);
  assert.equal((await store.getJobById(created.id))?.status, "running");
  assert.equal(await store.resetRunningJobsToPending(), 1);
  assert.equal(await store.cancelPendingJob(created.id), true);
  assert.equal((await store.getJobById(created.id))?.status, "cancelled");

  await workspace.dispose();
});

test("ActionScheduleStore serializes cross-instance pending claims", async (t) => {
  const workspace_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-action-schedule-lock-"),
  );
  t.after(async () => {
    await fs.rm(workspace_path, { recursive: true, force: true });
  });
  const first_workspace = new Workspace({ path: workspace_path });
  const second_workspace = new Workspace({ path: workspace_path });
  const first_store = new ActionScheduleStore(first_workspace.files);
  const second_store = new ActionScheduleStore(second_workspace.files);
  const created = await first_store.createJob({
    pluginName: "demo",
    actionName: "run",
    payload: null,
    runAtMs: Date.now(),
  });

  const claims = await Promise.all([
    first_store.markJobRunning(created.id),
    second_store.markJobRunning(created.id),
  ]);
  assert.deepEqual(claims.sort(), [false, true]);
  assert.equal((await first_store.getJobById(created.id))?.status, "running");

  await Promise.all([
    first_workspace.dispose(),
    second_workspace.dispose(),
  ]);
});
