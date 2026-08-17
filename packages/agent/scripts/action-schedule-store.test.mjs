/**
 * @file 验证 ActionScheduleStore 通过 AgentWorkspace 私有存储持久化异步事件流。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ActionScheduleStore, Workspace } from "../bin/index.js";

test("ActionScheduleStore persists through AgentWorkspace private FileSystem", async (t) => {
  const workspace_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-action-schedule-"),
  );
  t.after(async () => {
    await fs.rm(workspace_path, { recursive: true, force: true });
  });
  const workspace = new Workspace({ id: "test_workspace", path: workspace_path, data_root_path: path.join(workspace_path, "data") });
  const storage = workspace.create_agent_workspace_storage("schedule-test");
  const store = new ActionScheduleStore(
    storage.files,
    storage.root_path,
    "schedule-test",
    "test_workspace",
  );

  const created = await store.create_job({
    plugin_name: "demo",
    action_name: "run",
    payload: { value: 1 },
    run_at_ms: Date.now() - 1,
  });
  assert.equal(created.agent_id, "schedule-test");
  assert.equal(created.workspace_id, "test_workspace");
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
  const first_workspace = new Workspace({ id: "test_workspace", path: workspace_path, data_root_path: path.join(workspace_path, "data") });
  const second_workspace = new Workspace({ id: "test_workspace", path: workspace_path, data_root_path: path.join(workspace_path, "data") });
  const first_storage = first_workspace.create_agent_workspace_storage("schedule-test");
  const second_storage = second_workspace.create_agent_workspace_storage("schedule-test");
  const first_store = new ActionScheduleStore(first_storage.files, first_storage.root_path, "schedule-test", "test_workspace");
  const second_store = new ActionScheduleStore(second_storage.files, second_storage.root_path, "schedule-test", "test_workspace");
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
  const workspace = new Workspace({ id: "test_workspace", path: workspace_path, data_root_path: path.join(workspace_path, "data") });
  const storage = workspace.create_agent_workspace_storage("schedule-test");
  const store = new ActionScheduleStore(storage.files, storage.root_path, "schedule-test", "test_workspace");

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

test("ActionScheduleStore filters shared Workspace jobs by Agent ownership", async (t) => {
  const workspace_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-action-schedule-owner-"),
  );
  t.after(async () => {
    await fs.rm(workspace_path, { recursive: true, force: true });
  });
  const data_root_path = path.join(workspace_path, "data");
  const first_workspace = new Workspace({
    id: "test_workspace",
    path: workspace_path,
    data_root_path,
  });
  const second_workspace = new Workspace({
    id: "test_workspace",
    path: workspace_path,
    data_root_path,
  });
  const first_storage =
    first_workspace.create_agent_workspace_storage("first-agent");
  const second_storage =
    second_workspace.create_agent_workspace_storage("second-agent");
  const first_store = new ActionScheduleStore(
    first_storage.files,
    first_storage.root_path,
    "first-agent",
    "test_workspace",
  );
  const second_store = new ActionScheduleStore(
    second_storage.files,
    second_storage.root_path,
    "second-agent",
    "test_workspace",
  );
  const created = await first_store.create_job({
    plugin_name: "demo",
    action_name: "run",
    payload: null,
    run_at_ms: Date.now(),
  });

  assert.equal((await first_store.list_jobs()).length, 1);
  assert.equal((await second_store.list_jobs()).length, 0);
  assert.equal(await second_store.get_job_by_id(created.id), null);
  assert.equal(await second_store.mark_job_running(created.id), false);

  await Promise.all([
    first_workspace.dispose(),
    second_workspace.dispose(),
  ]);
});
