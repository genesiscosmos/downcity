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

  const created = await store.create_job({
    plugin_name: "demo",
    action_name: "run",
    payload: { value: 1 },
    run_at_ms: Date.now() - 1,
  });
  assert.equal((await store.list_due_pending_jobs(Date.now())).length, 1);
  assert.equal(await store.mark_job_running(created.id), true);
  assert.equal((await store.get_job_by_id(created.id))?.status, "running");
  assert.equal(await store.reset_running_jobs_to_pending(), 1);
  assert.equal(await store.cancel_pending_job(created.id), true);
  assert.equal((await store.get_job_by_id(created.id))?.status, "cancelled");

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
  const created = await first_store.create_job({
    plugin_name: "demo",
    action_name: "run",
    payload: null,
    run_at_ms: Date.now(),
  });

  const claims = await Promise.all([
    first_store.mark_job_running(created.id),
    second_store.mark_job_running(created.id),
  ]);
  assert.deepEqual(claims.sort(), [false, true]);
  assert.equal((await first_store.get_job_by_id(created.id))?.status, "running");

  await Promise.all([
    first_workspace.dispose(),
    second_workspace.dispose(),
  ]);
});

test("ActionScheduleStore only allows running jobs to enter terminal states", async (t) => {
  const workspace_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-action-schedule-state-"),
  );
  t.after(async () => {
    await fs.rm(workspace_path, { recursive: true, force: true });
  });
  const workspace = new Workspace({ path: workspace_path });
  const store = new ActionScheduleStore(workspace.files);

  const cancelled = await store.create_job({
    plugin_name: "demo",
    action_name: "cancelled",
    payload: null,
    run_at_ms: Date.now(),
  });
  assert.equal(await store.cancel_pending_job(cancelled.id), true);
  assert.equal(await store.mark_job_succeeded(cancelled.id), false);
  assert.equal((await store.get_job_by_id(cancelled.id))?.status, "cancelled");

  const running = await store.create_job({
    plugin_name: "demo",
    action_name: "running",
    payload: null,
    run_at_ms: Date.now(),
  });
  assert.equal(await store.mark_job_running(running.id), true);
  assert.equal(await store.mark_job_succeeded(running.id), true);
  assert.equal(await store.mark_job_failed(running.id, "late failure"), false);
  assert.equal((await store.get_job_by_id(running.id))?.status, "succeeded");

  await workspace.dispose();
});
