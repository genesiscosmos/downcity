/**
 * TaskRunnerSession：task runner 的 session 装配模块。
 *
 * 关键点（中文）
 * - 负责构建 task 专用 Executor / SessionMessages 运行时。
 * - 负责把每轮 user/assistant 消息写入 run 目录对应的 canonical Message Store。
 * - 这些能力与任务编排逻辑解耦后，task 主流程会更聚焦于状态流转。
 * - 当前只有 api 执行模式。
 */

import path from "node:path";
import type { LanguageModel, Tool } from "ai";
import type { PluginContext, SessionAttachmentStore } from "@downcity/agent";
import { Executor } from "@downcity/agent";
import type { SessionTurnExecutionResult } from "@downcity/agent";
import type { TaskSessionRuntimePort } from "@/task/runtime/TaskRunnerTypes.js";
import {
  DefaultSessionComposer,
  create_session_message_store,
  SessionMessages,
} from "@downcity/agent";
import { DefaultSessionSystemComposer } from "@downcity/agent";
import type { SessionExecutor } from "@downcity/agent";
import type {
  SessionComposeInput,
  SessionStepInput,
} from "@downcity/agent";

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
 * 构建 task 专用 Session 运行时（独立于普通 Session 实例缓存）。
 *
 * 关键点（中文）
 * - 使用 Executor 执行，但模型显式来自“任务绑定 session”的 session 级配置。
 * - task runner 自己维护独立 history，不复用原 session 的消息落盘。
 */
export function createTaskSessionRuntimePort(params: {
  context: PluginContext;
  model: LanguageModel;
  runDirAbs: string;
  runSessionId: string;
  userSimulatorSessionId: string;
  /** 当前 task 显式继承的 Agent env 快照。 */
  workspace_env?: Readonly<Record<string, string>>;
  /** 当前 task 显式继承的 Agent instruction 快照。 */
  agent_systems?: readonly string[];
}): TaskSessionRuntimePort {
  const {
    context,
    model,
    runDirAbs,
    runSessionId,
    userSimulatorSessionId,
  } = params;
  const effective_env = params.workspace_env
    ? { ...params.workspace_env }
    : { ...context.workspace_env };
  const effective_systems = params.agent_systems
    ? [...params.agent_systems]
    : [...context.instructions];
  const systemComposer = new DefaultSessionSystemComposer({
    project_root: context.workspace_path,
    get_static_system_prompts: () => [...effective_systems],
    get_context: () => context,
    profile: "task",
  });
  const messages_by_session_id = new Map<string, SessionMessages>();
  const created_at_by_session_id = new Map<string, number>();
  const runtimesBySessionId = new Map<string, SessionExecutor>();
  const shell = context.shell;
  if (!shell) {
    throw new Error("Task agent execution requires Agent to be configured with a Shell.");
  }
  const shell_tools = shell.tools as unknown as Record<string, Tool>;
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
        files: context.files,
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
    created_at_by_session_id.set(key, Date.now());
    return created;
  };

  class TaskSessionComposer extends DefaultSessionComposer {
    override async compose(input: SessionComposeInput): Promise<SessionStepInput> {
      const composed = await super.compose(input);
      return {
        ...composed,
        system: await systemComposer.resolve(input),
        system_blocks: undefined,
      };
    }
  }

  return {
    get_messages(session_id: string): SessionMessages {
      return resolve_task_messages(session_id);
    },
    get_executor(session_id: string): SessionExecutor {
      const key = String(session_id || "").trim();
      if (!key) {
        throw new Error("TaskSessionRuntimePort.get_executor requires a non-empty session_id");
      }
      const existing = runtimesBySessionId.get(key);
      if (existing) return existing;

      const messages = resolve_task_messages(key);
      const composer = new TaskSessionComposer();
      const created = new Executor({
        session_id: key,
        composer,
        get_compose_input: async (turn_context, retry_count) => ({
          session: {
            agent_id: "task",
            session_id: key,
            project_root: context.workspace_path,
            created_at: created_at_by_session_id.get(key) || Date.now(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          },
          state: {
            model,
            env: effective_env,
            systems: effective_systems,
            tools: shell_tools,
            instruction_system_blocks: [],
            managed_plugin_system_blocks: [],
            plugin_system_blocks: [],
          },
          history: await messages.context_snapshot(),
          turn: {
            ...(turn_context?.session.turn_id
              ? { turn_id: turn_context.session.turn_id }
              : {}),
            retry_count,
          },
        }),
        compact_history: async () => {
          try {
            const plan = await composer.compact({
              session: {
                agent_id: "task",
                session_id: key,
                project_root: context.workspace_path,
                created_at: created_at_by_session_id.get(key) || Date.now(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
              },
              model,
              history: await messages.context_snapshot(),
            });
            if (!plan) {
              return { compacted: false, reason: "nothing_to_compact" };
            }
            await messages.compact_active({
              through_sequence: plan.through_sequence,
              summary: plan.summary,
            });
            return { compacted: true };
          } catch {
            return { compacted: false, reason: "compact_failed" };
          }
        },
        get_model: () => model,
        logger: context.logger,
      });
      runtimesBySessionId.set(key, created);
      return created;
    },
  };
}

/**
 * 把 task session 的 assistant 消息落盘到对应 run context history Store。
 */
export async function appendTaskDeferredMessages(params: {
  taskSessionRuntime: TaskSessionRuntimePort;
  session_id: string;
  taskId: string;
  rawResult: SessionTurnExecutionResult;
}): Promise<void> {
  const { taskSessionRuntime, session_id, rawResult } = params;
  const messages = taskSessionRuntime.get_messages(session_id);
  const deferredUserMessages = rawResult.deferred_persisted_user_messages || [];
  for (const deferred of deferredUserMessages) {
    await messages.append_record(deferred);
  }
}
