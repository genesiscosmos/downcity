/**
 * Workspace 文件工具。
 *
 * 关键点（中文）
 * - 模型看到独立的 read/write/edit 工具，不需要构造 shell 命令。
 * - 工具只负责 schema 与 action 转发，文件语义由 FileActionRuntime 统一实现。
 */

import path from "node:path";
import { max_explicit_media_bytes, max_request_media_bytes, estimate_image_tokens } from "@downcity/type/workspace";
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
      "Read a project file or an attachment owned by this Session. Attachments always include a path reference. Small static PNG/JPEG/WebP images may already be included; call read when content_delivery is reference_only or other content is needed. Images and PDFs up to 2 MiB are explicitly attached to the next model step. For images, PDFs, and the default first text read, pass only file_path. Optional text range must choose one mode: {type:'lines',offset:0,limit:100} or {type:'bytes',offset:<next_byte_offset>,expected_version:<file_version>}. Do not invent versions. Text output is bounded to 64 KiB and 500 lines by default. Other binary files return metadata only and may require conversion tools.",
    input_schema: read_file_tool_input_schema,
    execute: async (
      input: ReadFileToolInput,
      context,
    ): Promise<WorkspaceToolActionResult<ReadFileToolResult>> => {
      context.abort_signal?.throwIfAborted();
      input = read_file_tool_input_schema.parse(input);
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
          // 原生工具媒体与顶层媒体共享总量；普通 JSON 内的 file 字段不是媒体协议。
          for (const item of part.type === "tool_result" ? part.content : [part]) {
            if (item.type === "file" && item.source.type === "base64") bytes += Buffer.byteLength(item.source.data, "base64");
          }
          return bytes;
        }, 0), 0);
        const estimated_tokens = output.type === "image"
          ? estimate_image_tokens(output.image_width && output.image_height ? { width: output.image_width, height: output.image_height } : undefined)
          : Math.ceil(output.total_bytes / 3) * 4;
        if (existing_media_bytes + output.total_bytes > max_request_media_bytes
          || (context.reserve_media && !context.reserve_media(output.total_bytes, existing_media_bytes, estimated_tokens))) {
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
