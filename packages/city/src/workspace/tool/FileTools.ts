/**
 * Workspace 文件工具。
 *
 * 关键点（中文）
 * - 模型看到独立的 read/write/edit 工具，不需要构造 shell 命令。
 * - 工具只负责 schema 与 action 转发，文件语义由 FileActionRuntime 统一实现。
 */

import path from "node:path";
import { max_explicit_media_bytes, max_request_media_bytes } from "@downcity/type/workspace";
import { define_agent_tool, type ToolEffect } from "@downcity/type";
import type { WorkspaceToolActionResult } from "@downcity/type/workspace";
import { create_workspace_file_mutation_effect } from "@downcity/type/workspace";
import type {
  EditFileToolInput,
  EditFileToolResult,
  FileToolRunner,
  FileToolSet,
  ReadFileToolInput,
  ReadFileToolResult,
  WriteFileToolInput,
  WriteFileToolResult,
} from "@downcity/type/workspace";
import {
  edit_file_tool_input_schema,
  read_file_tool_input_schema,
  write_file_tool_input_schema,
} from "@/workspace/tool/FileToolSchemas.js";

/** 创建 Workspace 持有的结构化文件工具。 */
export function create_file_tools(runner: FileToolRunner): FileToolSet {
  const read = define_agent_tool<ReadFileToolInput, WorkspaceToolActionResult<ReadFileToolResult>>({
    description:
      "Read a project file or an attachment owned by this Session. Uploaded attachments are references only: call read when content is needed. Images and PDFs up to 2 MiB are explicitly attached to the next model step. Text output is bounded to 64 KiB and 500 lines by default. Continue long lines with next_byte_offset as byte_offset and expected_version; omit offset and limit in byte mode. Other binary files return metadata only and may require conversion tools.",
    input_schema: read_file_tool_input_schema,
    execute: async (
      input: ReadFileToolInput,
      context,
    ): Promise<WorkspaceToolActionResult<ReadFileToolResult>> => {
      context.abort_signal?.throwIfAborted();
      const output = await context.read_attachment?.(input) ?? await runner.run_file_action({
        action: "read",
        input,
      }, undefined, context.abort_signal) as ReadFileToolResult;
      context.abort_signal?.throwIfAborted();
      const messages: WorkspaceToolActionResult<ReadFileToolResult>["messages"] = [];
      if (
        output.success &&
        (output.type === "image" || output.mime_type === "application/pdf")
      ) {
        if (output.total_bytes > max_explicit_media_bytes) {
          return { output: { success: false, error_code: "media_too_large", file_path: output.file_path,
            message: `Media is ${output.total_bytes} bytes; explicit read limit is ${max_explicit_media_bytes} bytes. Extract or convert a smaller file before reading. Content was not delivered.` }, messages };
        }
        const existing_media_bytes = (context.messages ?? []).reduce((sum, message) => sum + message.content.reduce((bytes, part) => {
          if (part.type !== "file") return bytes;
          return bytes + (part.source.type === "base64" ? Buffer.byteLength(part.source.data, "base64") : 0);
        }, 0), 0);
        if (existing_media_bytes + output.total_bytes > max_request_media_bytes
          || (context.reserve_media && !context.reserve_media(output.total_bytes, existing_media_bytes))) {
          return { output: { success: false, error_code: "media_too_large", file_path: output.file_path,
            message: "Explicit media exceeds the request media limit (4 MiB) or remaining model input budget. Content was not delivered; extract a smaller derivative." }, messages };
        }
        messages.push({
          role: "user",
          parts: [{
            type: "file",
            url: output.file_path,
            media_type: output.mime_type || "application/octet-stream",
            filename: path.basename(output.file_path),
            media_version: output.file_version,
          }],
        });
      }
      return { output, messages };
    },
  });

  const write = define_agent_tool<WriteFileToolInput, WorkspaceToolActionResult<WriteFileToolResult>>({
    description:
      "Create a new UTF-8 text file or atomically replace an existing file when overwrite=true. Parent directories are created automatically. Emit file_path before content. Use edit for changes to existing files. Keep each call small enough to finish generating; organize long documents by section and save large SVG illustrations as separate files.",
    input_schema: write_file_tool_input_schema,
    execute: async (
      input: WriteFileToolInput,
    ): Promise<WorkspaceToolActionResult<WriteFileToolResult>> => {
      const effects: ToolEffect[] = [];
      const output = await runner.run_file_action({
        action: "write",
        input,
      }, {
        on_file_mutation: (mutation) => {
          effects.push(create_workspace_file_mutation_effect(mutation));
        },
      }) as WriteFileToolResult;
      return { output, messages: [], effects };
    },
  });

  const edit = define_agent_tool<EditFileToolInput, WorkspaceToolActionResult<EditFileToolResult>>({
    description:
      "Atomically edit one text file using exact replacements. Every edits[].old_text must match exactly once in the original file, and edit regions must not overlap. Combine related changes to one file in a single call. Pass edits as a JSON array, never a JSON-encoded string. If validation fails, correct the original edit input instead of rewriting the entire file. Keep large changes scoped to sections.",
    input_schema: edit_file_tool_input_schema,
    execute: async (
      input: EditFileToolInput,
    ): Promise<WorkspaceToolActionResult<EditFileToolResult>> => {
      const effects: ToolEffect[] = [];
      const output = await runner.run_file_action({
        action: "edit",
        input,
      }, {
        on_file_mutation: (mutation) => {
          effects.push(create_workspace_file_mutation_effect(mutation));
        },
      }) as EditFileToolResult;
      return { output, messages: [], effects };
    },
  });

  return { read, write, edit };
}
