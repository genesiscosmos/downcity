/**
 * Workspace 文件工具。
 *
 * 关键点（中文）
 * - 模型看到独立的 read/write/edit 工具，不需要构造 shell 命令。
 * - 工具只负责 schema 与 action 转发，文件语义由 FileActionRuntime 统一实现。
 */

import path from "node:path";
import { define_runtime_tool, type RuntimeToolEffect } from "@downcity/type";
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
  const read = define_runtime_tool<ReadFileToolInput, WorkspaceToolActionResult<ReadFileToolResult>>({
    description:
      "Read a project file instead of using cat or sed. Chat attachments are hydrated by the Session and are not project file paths. Images and PDFs are attached to the next model step as local file parts. Text output is limited to 500 lines and 256KB by default; use offset and limit to continue. Other binary files return metadata only.",
    input_schema: read_file_tool_input_schema,
    execute: async (
      input: ReadFileToolInput,
    ): Promise<WorkspaceToolActionResult<ReadFileToolResult>> => {
      const output = await runner.run_file_action({
        action: "read",
        input,
      }) as ReadFileToolResult;
      const messages: WorkspaceToolActionResult<ReadFileToolResult>["messages"] = [];
      if (
        output.success &&
        (output.type === "image" || output.mime_type === "application/pdf")
      ) {
        messages.push({
          role: "user",
          parts: [{
            type: "file",
            url: output.file_path,
            media_type: output.mime_type || "application/octet-stream",
            filename: path.basename(output.file_path),
          }],
        });
      }
      return { output, messages };
    },
  });

  const write = define_runtime_tool<WriteFileToolInput, WorkspaceToolActionResult<WriteFileToolResult>>({
    description:
      "Create a new UTF-8 text file or atomically replace an existing file when overwrite=true. Parent directories are created automatically. Use edit for partial changes.",
    input_schema: write_file_tool_input_schema,
    execute: async (
      input: WriteFileToolInput,
    ): Promise<WorkspaceToolActionResult<WriteFileToolResult>> => {
      const effects: RuntimeToolEffect[] = [];
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

  const edit = define_runtime_tool<EditFileToolInput, WorkspaceToolActionResult<EditFileToolResult>>({
    description:
      "Atomically edit one text file using exact replacements. Every edits[].old_text must match exactly once in the original file, and edit regions must not overlap. Combine separate changes to one file in a single call.",
    input_schema: edit_file_tool_input_schema,
    execute: async (
      input: EditFileToolInput,
    ): Promise<WorkspaceToolActionResult<EditFileToolResult>> => {
      const effects: RuntimeToolEffect[] = [];
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
