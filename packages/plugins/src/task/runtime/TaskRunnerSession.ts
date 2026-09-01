/**
 * TaskRunnerSession：task runner 的 session 装配模块。
 *
 * 关键点（中文）
 * - 负责通过宿主 Agent 的 Session 集合创建 task session。
 * - 负责把每轮 user/assistant 消息写入 run 目录对应的 canonical Message Store。
 * - 这些能力与任务编排逻辑解耦后，task 主流程会更聚焦于状态流转。
 * - 当前只有 api 执行模式。
 */

import path from "node:path";
import type {
  PluginContext,
  SessionAttachmentStore,
  SessionPort,
} from "@downcity/agent";
import type { TaskSessionRuntimePort } from "@/task/runtime/TaskRunnerTypes.js";
import { create_session_message_store, SessionMessages } from "@downcity/agent";

/**
 * 把 task round 的 user query 落盘到对应 run context。
 */
export async function appendTaskRoundUserMessage(params: {
  taskSessionRuntime: TaskSessionRuntimePort;
  session_id: string;
  taskId: string;
  query: string;
  actorId: string;
  actorName: string;
}): Promise<void> {
  const text = String(params.query || "").trim();
  if (!text) return;
  const messages = params.taskSessionRuntime.get_messages(params.session_id);
  await messages.append_user_message({
    turn_id:
      `task:${params.taskId}:${params.actorId}:${Date.now()}`,
    input_type: "prompt",
    parts: [{
      part_id: `task-user:${Date.now()}`,
      type: "text",
      text,
      state: "done",
    }],
  });
}

/**
 * 构建 task 专用 Session 运行时。
 *
 * 关键点（中文）
 * - Executor、Plugin tools 与 system blocks 全部来自宿主 Agent。
 * - run 目录仍保留 task 专用调试消息，宿主 Session 保存实际执行历史。
 */
export async function createTaskSessionRuntimePort(params: {
  context: PluginContext;
  runDirAbs: string;
  runSessionId: string;
  userSimulatorSessionId: string;
  sourceSessionId?: string;
}): Promise<TaskSessionRuntimePort> {
  const { context, runDirAbs, runSessionId, userSimulatorSessionId } = params;
  const task_session = await context.sessions.create();
  const user_simulator_session = await context.sessions.create();
  const source_session = params.sourceSessionId
    ? await context.sessions.get(params.sourceSessionId)
    : undefined;
  if (source_session?.config.model) {
    await task_session.set(
      { model: source_session.config.model },
      { persist_action: false, publish_mutation: false },
    );
    await user_simulator_session.set(
      { model: source_session.config.model },
      { persist_action: false, publish_mutation: false },
    );
  }
  const sessions_by_alias = new Map<string, SessionPort>([
    [runSessionId, context.sessions.runtime(task_session.id)],
    [userSimulatorSessionId, context.sessions.runtime(user_simulator_session.id)],
  ]);
  const messages_by_session_id = new Map<string, SessionMessages>();
  /**
   * Task runtime 当前只接收已经规范化的文本消息，不支持通过 Prompt 传入 Data URL 附件。
   * 显式提供适配器，避免把 Task 的临时 run 目录错误地当成普通 Session 附件目录。
   */
  const attachment_store: SessionAttachmentStore = {
    persist_data_url: async () => {
      throw new Error("Task session runtime does not support Data URL attachments");
    },
  };

  const resolve_task_messages = (session_id: string): SessionMessages => {
    const existing = messages_by_session_id.get(session_id);
    if (existing) return existing;

    const key = String(session_id || "").trim();
    if (!key) {
      throw new Error("TaskSessionRuntimePort requires a non-empty session_id");
    }
    const runMessagesDirPath =
      key === runSessionId
        ? runDirAbs
        : key === userSimulatorSessionId
          ? path.join(runDirAbs, "user-simulator")
          : undefined;

    const messages_dir_path = runMessagesDirPath || path.join(runDirAbs, key);
    const created = new SessionMessages({
      session_id: key,
      store: create_session_message_store({
        files: context.data_files,
        session_id: key,
        file_path: path.join(messages_dir_path, "active.jsonl"),
        assistant_message_file_path: path.join(
          messages_dir_path,
          "assistant_message.json",
        ),
      }),
      attachment_store,
      publish: () => {},
    });
    messages_by_session_id.set(key, created);
    return created;
  };

  return {
    get_messages(session_id: string): SessionMessages {
      return resolve_task_messages(session_id);
    },
    get_session(session_id: string): SessionPort {
      const key = String(session_id || "").trim();
      const session = sessions_by_alias.get(key);
      if (!session) throw new Error(`Task session "${key}" is not registered`);
      return session;
    },
  };
}
