/**
 * Plugin tool 运行时桥接。
 *
 * 关键点（中文）
 * - tool 层不直接持有 agent 或 plugin registry，只通过装配期注入的 AgentPlugins 调用 action。
 * - 如果 action 返回 AI SDK UIMessage，则抽取 file parts 并入最终 assistant 消息。
 * - 返回给模型的 tool result 只保留短摘要和本地绝对路径，避免 data URL 等大内容污染上下文。
 */

import path from "node:path";
import type { FileUIPart } from "ai";
import type { JsonObject, JsonValue } from "@/types/common/Json.js";
import type {
  PluginCallInput,
  PluginCallToolFileResult,
  PluginCallToolResult,
  PluginReadInput,
  PluginReadToolResult,
} from "@/executor/tools/plugin/types/PluginTool.js";
import type {
  InvokePluginCallToolOptions,
  InvokePluginReadToolOptions,
} from "@/types/plugin/PluginToolRuntime.js";
import {
  materialize_assistant_file_parts,
  resolve_agent_file_path,
} from "@executor/messages/AssistantFileResource.js";

/**
 * 判断值是否为普通对象。
 */
function to_json_object(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

/**
 * 判断 UI part 是否为 file part。
 */
function is_file_part(value: unknown): value is FileUIPart {
  const record = to_json_object(value);
  if (!record) return false;
  return (
    record.type === "file" &&
    typeof record.mediaType === "string" &&
    typeof record.url === "string"
  );
}

/**
 * 从 action data 中抽取可落盘的 assistant file parts。
 */
function extract_assistant_file_parts(data: JsonValue | undefined): FileUIPart[] {
  const message = to_json_object(data);
  const parts: unknown[] = Array.isArray(message?.parts) ? message.parts : [];
  return parts.filter(is_file_part);
}

/**
 * 解析当前项目根目录，保持与 assistant 文件落盘逻辑一致。
 */
function resolve_project_root(project_root: string | undefined): string {
  const raw = String(project_root || "").trim();
  return path.resolve(raw || process.cwd());
}

/**
 * 构建返回给模型和用户可见的文件摘要。
 */
function summarize_materialized_files(
  parts: FileUIPart[],
  project_root: string,
): PluginCallToolFileResult[] {
  return parts.map((part, index) => {
    const relative_path = String(part.url || "");
    return {
      index,
      media_type: part.mediaType,
      filename: typeof part.filename === "string" ? part.filename : "",
      relative_path,
      path: resolve_agent_file_path({
        project_root: project_root,
        filePath: relative_path,
      }),
    };
  });
}

/**
 * 生成给模型读取的短摘要。
 */
function summarize_action_data(data: JsonValue | undefined): JsonObject | undefined {
  const message = to_json_object(data);
  const parts: unknown[] = Array.isArray(message?.parts) ? message.parts : [];
  if (parts.length > 0) {
    return undefined;
  }
  if (data === undefined) return {};
  return {
    kind: "json",
    value: data,
  };
}

/**
 * 调用 plugin action 并桥接最终 assistant file parts。
 */
export async function invoke_plugin_call_tool(
  params: InvokePluginCallToolOptions,
): Promise<PluginCallToolResult> {
  const input: PluginCallInput = params.input;
  const plugin = String(input.plugin || "").trim();
  const action = String(input.action || "").trim();
  const payload = to_json_object(input.payload ?? {}) ?? {};
  if (!plugin) {
    return {
      success: false,
      plugin,
      action,
      assistant_file_count: 0,
      message: "plugin is required",
      error: "plugin is required",
    };
  }
  if (!action) {
    return {
      success: false,
      plugin,
      action,
      assistant_file_count: 0,
      message: "action is required",
      error: "action is required",
    };
  }

  try {
    const turn_context = params.turn_context;
    const plugins = turn_context.step.plugins || params.plugins;
    const result = await plugins.run_action({
      plugin,
      action,
      payload,
      execution_context: turn_context.step.plugin_execution_context(),
    });
    const project_root = resolve_project_root(turn_context.session.project_root);
    const raw_file_parts = result.success
      ? extract_assistant_file_parts(result.data)
      : [];
    const file_parts =
      raw_file_parts.length > 0
        ? await materialize_assistant_file_parts({
            project_root: project_root,
            parts: raw_file_parts,
          })
        : [];
    const files = summarize_materialized_files(file_parts, project_root);
    if (file_parts.length > 0) {
      turn_context.output.attach_files(file_parts);
    }
    const data = summarize_action_data(result.data);
    return {
      success: result.success,
      plugin,
      action,
      assistant_file_count: file_parts.length,
      ...(files.length > 0 ? { files } : {}),
      message:
        String(result.message || result.error || "").trim() ||
        (result.success ? "plugin action completed" : "plugin action failed"),
      ...(result.error ? { error: result.error } : {}),
      ...(data === undefined ? {} : { data }),
    };
  } catch (error) {
    return {
      success: false,
      plugin,
      action,
      assistant_file_count: 0,
      message: String(error),
      error: String(error),
    };
  }
}

/**
 * 读取 plugin / action metadata。
 */
export async function invoke_plugin_read_tool(
  params: InvokePluginReadToolOptions,
): Promise<PluginReadToolResult> {
  const input: PluginReadInput = params.input;
  try {
    const plugins = params.turn_context.step.plugins || params.plugins;
    const data = plugins.read({
      plugin: typeof input.plugin === "string" ? input.plugin : undefined,
      action: typeof input.action === "string" ? input.action : undefined,
    });
    return {
      success: true,
      message: "plugin metadata read",
      data: data as unknown as JsonObject,
    };
  } catch (error) {
    return {
      success: false,
      message: String(error),
      data: {
        error: String(error),
      },
    };
  }
}
