/**
 * Shell Power：Workspace 命令与长期进程能力在模型侧的具名 power。
 *
 * 关键点（中文）
 * - 继承 `Power` 基类，与 `city` 同构，由 City 注册，工具名即 `shell`。
 * - 动作 id 是点号形式（`shell.exec`、`shell.session_start`），
 *   取代此前 `shell_exec` + `shell_session({ action })` 两个工具与其中的动作开关。
 * - 真正的执行、输出游标与响应整理仍由 Workspace 持有的 Shell 负责：
 *   本 power 只是把已有 tool 适配成动作，不复制那套逻辑。
 * - host 目标仍走 Shell 自己的审批网关；网关由动作执行上下文直接提供，
 *   与其它 power 动作使用同一个审批端口。
 */

import { z } from "zod";
import type { AgentTool } from "@downcity/type";
import type {
  PowerAction,
  PowerActionExecutionContext,
  PowerActionResult,
  PowerActions,
  PowerJsonObject,
  PowerJsonValue,
  PowerContext,
} from "@/power/index.js";
import { Power } from "@/power/index.js";

/** shell 工具在 Shell 持有的工具集中的稳定名字。 */
const SHELL_EXEC_TOOL = "shell_exec";
const SHELL_SESSION_TOOL = "shell_session";

/** 执行目标；sandbox 为默认，host 需要审批。 */
const target_schema = z
  .enum(["sandbox", "host"])
  .optional()
  .describe("Execution target. sandbox is the default; host requires user approval.");

/** host 目标必须给出的理由。 */
const reason_schema = z
  .string()
  .optional()
  .describe("Required when target is host. Explain why host execution is needed.");

/** 可选的 shell 可执行文件路径。 */
const shell_path_schema = z
  .string()
  .optional()
  .describe("Optional shell executable path. Example: /bin/zsh or C:\\Windows\\System32\\cmd.exe");

/** 可选工作目录；相对路径以项目根为基准。 */
const workdir_schema = z
  .string()
  .optional()
  .describe("Optional working directory. Relative path is resolved from project root.");

/** `shell.exec` 输入。 */
const exec_input = z.strictObject({
  /** 一次性执行并等待结束的命令。 */
  cmd: z.string().describe("Shell command to execute once and wait until completion."),
  workdir: workdir_schema,
  shell: shell_path_schema,
  /** POSIX 下是否用 -lc 代替 -c。 */
  login: z
    .boolean()
    .optional()
    .describe("Whether POSIX shells use -lc instead of -c. Ignored by the Windows cmd model."),
  /** 一次性执行的总超时，毫秒。 */
  timeout_ms: z
    .number()
    .optional()
    .describe("Total timeout for one-shot execution in milliseconds; shell.session_start is preferred for long-running commands."),
  /** 单次返回的最大输出 token 数。 */
  max_output_tokens: z
    .number()
    .optional()
    .describe("Maximum output tokens returned in the final result."),
  target: target_schema,
  reason: reason_schema,
});

/** `shell.session_start` 输入。 */
const session_start_input = z.strictObject({
  /** 启动并保持交互的命令。 */
  cmd: z.string().describe("Shell command to start as an interactive session."),
  workdir: workdir_schema,
  shell: shell_path_schema,
  /** POSIX 下是否用 -lc 代替 -c。 */
  login: z
    .boolean()
    .optional()
    .describe("Whether POSIX shells use -lc instead of -c. Ignored by the Windows cmd model."),
  /** 启动后返回前等待输出多久，毫秒。 */
  inline_wait_ms: z
    .number()
    .optional()
    .describe("How long to wait after start before returning output, in milliseconds."),
  max_output_tokens: z
    .number()
    .optional()
    .describe("Maximum output tokens returned in a single read chunk."),
  /** 命令退出时是否发完成通知。 */
  auto_notify_on_exit: z
    .boolean()
    .optional()
    .describe("Whether the shell runtime should emit a completion notification when the command exits."),
  /** PTY 列数。 */
  cols: z.number().optional().describe("PTY columns for start. Defaults to 120."),
  /** PTY 行数。 */
  rows: z.number().optional().describe("PTY rows for start. Defaults to 40."),
  target: target_schema,
  reason: reason_schema,
});

/** `shell.session_send` 输入。 */
const session_send_input = z.strictObject({
  /** 目标会话标识。 */
  shell_id: z.string().describe("Existing shell session identifier."),
  /** 写入 PTY 的文本。 */
  input: z.string().describe("Text to send to the PTY session."),
  /** 写入后等待输出多久，毫秒。 */
  wait_ms: z
    .number()
    .optional()
    .describe("How long to wait for output after sending, in milliseconds."),
  max_output_tokens: z
    .number()
    .optional()
    .describe("Maximum output tokens returned in a single read chunk."),
});

/** `shell.session_read` 输入。 */
const session_read_input = z.strictObject({
  /** 目标会话标识。 */
  shell_id: z.string().describe("Existing shell session identifier."),
  max_output_tokens: z
    .number()
    .optional()
    .describe("Maximum output tokens returned in a single read chunk."),
});

/** `shell.session_list` 输入。 */
const session_list_input = z.strictObject({
  /** 是否把已结束的会话也列出来。 */
  include_completed: z
    .boolean()
    .optional()
    .describe("Whether list should include completed sessions. Defaults to true."),
});

/** `shell.session_stop` 输入。 */
const session_stop_input = z.strictObject({
  /** 目标会话标识。 */
  shell_id: z.string().describe("Existing shell session identifier."),
  /** 是否强制结束。 */
  force: z.boolean().optional().describe("Whether stop should force-kill the session."),
  /** 请求理由。 */
  reason: reason_schema,
});

/** 取得当前 Workspace 的 Shell 工具；不可用时给出明确原因。 */
function require_shell_tool(
  context: PowerContext,
  tool_name: string,
): AgentTool<never, PowerJsonObject> | null {
  const shell = context.workspace.shell;
  if (!shell) return null;
  const tool = shell.tools?.[tool_name];
  return tool ? (tool as AgentTool<never, PowerJsonObject>) : null;
}

/**
 * 执行一次 shell 工具并映射为 power 动作结果。
 *
 * 关键点（中文）
 * - 工具返回的是面向模型的扁平 JSON；这里只做信封映射，不改字段。
 * - Shell 所需的 Session 身份、取消信号与审批端口都从动作执行上下文直接构造，
 *   不再依赖宿主透传的不透明上下文。
 */
async function run_shell_tool(input: {
  /** City 投影的通用上下文。 */
  readonly context: PowerContext;
  /** 动作执行上下文。 */
  readonly execution: PowerActionExecutionContext;
  /** 目标工具名。 */
  readonly tool_name: string;
  /** 工具入参。 */
  readonly payload: PowerJsonValue;
}): Promise<PowerActionResult<PowerJsonValue>> {
  const tool = require_shell_tool(input.context, input.tool_name);
  if (!tool) {
    return {
      success: false,
      error: "This Workspace has no Shell capability, so shell actions are unavailable.",
      message: "This Workspace has no Shell capability, so shell actions are unavailable.",
    };
  }
  if (typeof tool.execute !== "function") {
    return {
      success: false,
      error: `Shell tool "${input.tool_name}" has no executor.`,
      message: `Shell tool "${input.tool_name}" has no executor.`,
    };
  }
  const session = input.execution.session;
  // Shell 工具与其他工具共享同一份 ToolCallContext；这里把 Power 侧执行身份
  // 投影为调用环境，Shell 不再有专用嵌套上下文。Shell 不需要 Workspace 实例，
  // 它的 cwd 与 root 已在 bind 阶段固定。
  const output = await tool.execute(input.payload as never, {
    agent_id: input.context.agent.id,
    agent_name: input.context.agent.name,
    agent_description: input.context.agent.description,
    agent_instructions: input.context.agent.instructions,
    session_id: session?.session_id || input.execution.snapshot.session_id || "",
    session_origin: session?.origin
      ?? input.execution.snapshot.session_origin
      ?? { type: "chat" },
    ...(session ? { turn_id: session.turn_id } : {}),
    abort_signal: input.execution.abort_signal,
    tool_call_id: input.execution.call_id,
    messages: [],
    interactions: input.execution.interactions,
    ...(input.execution.snapshot.workspace_env
      ? { workspace_env: input.execution.snapshot.workspace_env }
      : {}),
  });
  const record = (output ?? {}) as PowerJsonObject;
  const success = record.success !== false;
  return {
    success,
    data: record,
    message: success ? `${input.tool_name} completed` : String(record.error || "shell action failed"),
    ...(success ? {} : { error: String(record.error || "shell action failed") }),
  };
}

/** 构造一个 shell 动作。 */
function create_shell_action(input: {
  /** 动作名，不含 power 前缀。 */
  readonly action: string;
  /** 动作摘要。 */
  readonly description: string;
  /** 返回结构说明。 */
  readonly returns: string;
  /** 读写性质：shell 一律会改变外部状态。 */
  readonly access: "read" | "write";
  /** 目标工具名。 */
  readonly tool_name: string;
  /** 参数 schema。 */
  readonly args_schema: z.ZodTypeAny;
  /** 把动作入参映射为工具入参。 */
  readonly to_payload?: (args: Record<string, unknown>) => PowerJsonObject;
}): PowerAction {
  const json_schema = to_json_schema(input.args_schema);
  return {
    description: input.description,
    returns: input.returns,
    access: input.access,
    input_schema: {
      zod: input.args_schema,
      ...(json_schema ? { json_schema } : {}),
    },
    async execute(params) {
      const args = (params.input ?? {}) as Record<string, unknown>;
      const payload = input.to_payload ? input.to_payload(args) : (args as PowerJsonObject);
      return await run_shell_tool({
        context: params.context,
        execution: params.execution,
        tool_name: input.tool_name,
        payload: payload as PowerJsonValue,
      });
    },
  };
}

/**
 * Shell 自有 power：把 Workspace Shell 工具装配为模型可见动作。
 *
 * 关键点（中文）
 * - Shell 本身属于 Workspace；本 power 是它在模型面的唯一入口。
 * - 动作与已注册 power 同构：省略 action 返回索引，参数由 Zod 声明。
 */
export class ShellPower extends Power {
  /** Power 稳定名称，即模型侧工具名。 */
  readonly name = "shell";

  /** Power 用户可见标题。 */
  readonly title = "Shell";

  /** Power 用途说明。 */
  readonly description =
    "Run commands and manage interactive sessions in the Workspace's isolated Sandbox. "
    + "Host execution is not the default and requires approval.";

  /** 当前 power 的完整动作集合。 */
  readonly actions: PowerActions = {
    exec: create_shell_action({
      action: "exec",
      description:
        "Execute a short non-interactive shell command and wait for completion. Prefer shell.session_start for long-running or interactive commands.",
      returns:
        "success, status, cmd, cwd, target, approval_status, execution_backend, sandbox_id, "
        + "exit_code, output, original_chars, original_lines, wall_time_seconds",
      access: "write",
      tool_name: SHELL_EXEC_TOOL,
      args_schema: exec_input,
    }),
    session_start: create_shell_action({
      action: "session_start",
      description:
        "Start an interactive PTY shell session for a long-running or interactive command.",
      returns:
        "success, shell_id, status, cmd, cwd, target, approval_status, terminal, pid, "
        + "output, output_chars, wall_time_seconds",
      access: "write",
      tool_name: SHELL_SESSION_TOOL,
      args_schema: session_start_input,
      to_payload: (args) => ({ ...args, action: "start" }) as PowerJsonObject,
    }),
    session_send: create_shell_action({
      action: "session_send",
      description: "Send text to the stdin of an existing shell session and read the new output.",
      returns: "success, shell_id, status, output, output_chars, exit_code, wall_time_seconds",
      access: "write",
      tool_name: SHELL_SESSION_TOOL,
      args_schema: session_send_input,
      to_payload: (args) => ({ ...args, action: "send" }) as PowerJsonObject,
    }),
    session_read: create_shell_action({
      action: "session_read",
      description: "Read the latest output of an existing shell session without sending input.",
      returns: "success, shell_id, status, output, output_chars, exit_code, wall_time_seconds",
      access: "read",
      tool_name: SHELL_SESSION_TOOL,
      args_schema: session_read_input,
      to_payload: (args) => ({ ...args, action: "read" }) as PowerJsonObject,
    }),
    session_list: create_shell_action({
      action: "session_list",
      description: "List the shell sessions that belong to this Workspace.",
      returns: "success, sessions(shell_id, status, cmd, cwd, terminal, exit_code, output_chars), wall_time_seconds",
      access: "read",
      tool_name: SHELL_SESSION_TOOL,
      args_schema: session_list_input,
      to_payload: (args) => ({ ...args, action: "list" }) as PowerJsonObject,
    }),
    session_stop: create_shell_action({
      action: "session_stop",
      description: "Close an existing shell session and release its process resources.",
      returns: "success, shell_id, status, exit_code, wall_time_seconds",
      access: "write",
      tool_name: SHELL_SESSION_TOOL,
      args_schema: session_stop_input,
      to_payload: (args) => ({ ...args, action: "stop" }) as PowerJsonObject,
    }),
  };

  /** Shell 能力的模型侧使用说明。 */
  system(): string {
    return [
      "# Shell",
      "",
      "One-shot commands: `shell({ action: \"exec\", args: { cmd } })`.",
      "Interactive or long-running work: `session_start`, then `session_send` / `session_read` /",
      "`session_list` / `session_stop`.",
      "",
      "Commands run in the Workspace's persistent isolated Sandbox by default.",
      "`target: \"host\"` runs on the real machine and requires approval; pass `reason` when using it.",
      "Do not ask for a separate chat confirmation before a host call whose command and reason are already clear.",
    ].join("\n");
  }
}

/** 尽力把 Zod schema 转为 JSON Schema；失败时返回 null。 */
function to_json_schema(schema: unknown): PowerJsonObject | null {
  const candidate = schema as { toJSONSchema?: () => unknown } | null;
  if (!candidate || typeof candidate.toJSONSchema !== "function") return null;
  try {
    const value = candidate.toJSONSchema();
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as PowerJsonObject;
  } catch {
    return null;
  }
}
