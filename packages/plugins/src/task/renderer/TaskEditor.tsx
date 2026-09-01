/** Task 创建与编辑表单。 */

import { useEffect, useState } from "react";
import type { TaskMainviewEditorDraft } from "@/task/types/TaskMainview.js";
import type { TaskEditorProps } from "@/task/types/TaskRenderer.js";

/** 使用宿主统一表单原语展示 Task 编辑器。 */
export function TaskEditor({
  mode,
  task,
  workspaces,
  busy,
  error,
  components,
  on_cancel,
  on_submit,
}: TaskEditorProps) {
  const { Button, Callout, Field, Input, Page, Select, Stack, Switch, Textarea, Toolbar } = components;
  const creating = mode === "create";
  const [draft, set_draft] = useState<TaskMainviewEditorDraft>(() => create_draft(task, workspaces[0]?.workspace_id ?? ""));
  const can_submit = Boolean(
    draft.title.trim()
    && draft.description.trim()
    && draft.when.trim()
    && draft.workspace_id
    && !busy,
  );

  useEffect(() => {
    set_draft(create_draft(task, workspaces[0]?.workspace_id ?? ""));
  }, [mode, task?.title, workspaces]);

  const update_draft = <Key extends keyof TaskMainviewEditorDraft>(
    key: Key,
    value: TaskMainviewEditorDraft[Key],
  ) => set_draft((current) => ({ ...current, [key]: value }));

  return <Page>
    <Toolbar
      title={creating ? "新建 Task" : task?.title ?? "编辑 Task"}
      description={creating ? "先创建基础任务，调度与执行方式可在编辑中调整。" : "修改 Task 的执行内容与运行配置。"}
      actions={<><Button disabled={busy} on_click={on_cancel}>取消</Button><Button variant="primary" disabled={!can_submit} on_click={() => void on_submit(normalize_draft(draft))}>{busy ? "处理中…" : creating ? "创建" : "保存"}</Button></>}
    />
    {error ? <Callout tone="danger">{error}</Callout> : null}
    <Stack>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Field label="名称" description={mode === "edit" ? "Task 名称创建后保持稳定。" : "在当前 Agent 下唯一。"}>
          <Input fill value={draft.title} disabled={mode === "edit" || busy} placeholder="例如：daily-report" on_value_change={(value) => update_draft("title", value)} />
        </Field>
        <Field label="执行 Workspace" description="手动与定时执行都使用这个 Workspace。">
          <Select fill value={draft.workspace_id} disabled={busy} options={workspaces.map((workspace) => ({ value: workspace.workspace_id, label: workspace.name }))} on_value_change={(value) => update_draft("workspace_id", value)} />
        </Field>
      </div>
      <Field label="说明" description="说明 Task 的用途，便于列表识别。">
        <Input fill value={draft.description} disabled={busy} placeholder="这个 Task 会完成什么" on_value_change={(value) => update_draft("description", value)} />
      </Field>
      {!creating ? <>
        <div className="grid min-w-0 gap-4 md:grid-cols-3">
          <Field label="触发条件" description="支持 @manual、Cron 或 time:ISO。">
            <Input fill value={draft.when} disabled={busy} placeholder="@manual" on_value_change={(value) => update_draft("when", value)} />
          </Field>
          <Field label="执行类型">
            <Select fill value={draft.kind} disabled={busy} options={[{ value: "agent", label: "Agent" }, { value: "script", label: "Script" }]} on_value_change={(value) => update_draft("kind", value === "script" ? "script" : "agent")} />
          </Field>
          <Field label="状态">
            <Select fill value={draft.status} disabled={busy} options={[{ value: "enabled", label: "启用" }, { value: "paused", label: "暂停" }, ...(draft.status === "disabled" ? [{ value: "disabled", label: "禁用" }] : [])]} on_value_change={(value) => update_draft("status", value === "enabled" ? "enabled" : value === "disabled" ? "disabled" : "paused")} />
          </Field>
        </div>
        {draft.kind === "agent" ? <Field label="多轮复核" description="让 Agent 在初稿后执行审阅与修订。">
          <div className="flex h-8 items-center"><Switch checked={draft.review} disabled={busy} aria_label="启用多轮复核" on_checked_change={(checked) => update_draft("review", checked)} /></div>
        </Field> : null}
      </> : null}
      <Field label={draft.kind === "script" ? "脚本" : "任务正文"} description={creating ? "描述目标、输入和希望得到的最终结果。" : draft.kind === "script" ? "填写可直接执行的脚本内容。" : "清晰描述目标、约束和最终产物。"}>
        <Textarea value={draft.body} disabled={busy} rows={12} placeholder={draft.kind === "script" ? "#!/usr/bin/env bash" : "描述 Task 要完成的工作"} on_value_change={(value) => update_draft("body", value)} />
      </Field>
    </Stack>
  </Page>;
}

/** 从既有 Task 或默认值创建独立表单草稿。 */
function create_draft(task: TaskEditorProps["task"], default_workspace_id: string): TaskMainviewEditorDraft {
  return {
    workspace_id: task?.workspace_id ?? default_workspace_id,
    title: task?.title ?? "",
    description: task?.description ?? "",
    when: task?.when ?? "@manual",
    kind: task?.kind ?? "agent",
    review: task?.review ?? false,
    status: task?.status === "enabled" || task?.status === "disabled" ? task.status : "paused",
    body: task?.body ?? "",
  };
}

/** 在提交边界统一清理可持久化字符串。 */
function normalize_draft(draft: TaskMainviewEditorDraft): TaskMainviewEditorDraft {
  return {
    ...draft,
    title: draft.title.trim(),
    description: draft.description.trim(),
    when: draft.when.trim(),
    body: draft.body.trim(),
    review: draft.kind === "agent" && draft.review,
  };
}
