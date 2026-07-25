/**
 * 文件 AI SDK tools。
 *
 * 关键点（中文）
 * - 模型看到独立的 read/write/edit 工具，不需要构造 shell 命令。
 * - 工具只负责 schema 与 action 转发，文件语义由 FileActionRuntime 统一实现。
 */

import { tool } from "ai";
import type {
  EditFileToolInput,
  EditFileToolResult,
  FileToolRunner,
  FileToolSet,
  ReadFileToolInput,
  ReadFileToolResult,
  WriteFileToolInput,
  WriteFileToolResult,
} from "@/types/workspace/FileTool.js";
import {
  edit_file_tool_input_schema,
  read_file_tool_input_schema,
  write_file_tool_input_schema,
} from "@/workspace/tool/FileToolSchemas.js";

/** 创建 Workspace 持有的结构化文件工具。 */
export function create_file_tools(runner: FileToolRunner): FileToolSet {
  const read = tool({
    description:
      "Read a project file instead of using cat or sed. Images are attached to the next model step. Text output is limited to 500 lines and 256KB by default; use offset and limit to continue. Other binary files return metadata only.",
    inputSchema: read_file_tool_input_schema,
    execute: async (input: ReadFileToolInput): Promise<ReadFileToolResult> => {
      return await runner.run_file_action({ action: "read", input }) as ReadFileToolResult;
    },
  });

  const write = tool({
    description:
      "Create a new UTF-8 text file or atomically replace an existing file when overwrite=true. Parent directories are created automatically. Use edit for partial changes.",
    inputSchema: write_file_tool_input_schema,
    execute: async (input: WriteFileToolInput): Promise<WriteFileToolResult> => {
      return await runner.run_file_action({ action: "write", input }) as WriteFileToolResult;
    },
  });

  const edit = tool({
    description:
      "Atomically edit one text file using exact replacements. Every edits[].old_text must match exactly once in the original file, and edit regions must not overlap. Combine separate changes to one file in a single call.",
    inputSchema: edit_file_tool_input_schema,
    execute: async (input: EditFileToolInput): Promise<EditFileToolResult> => {
      return await runner.run_file_action({ action: "edit", input }) as EditFileToolResult;
    },
  });

  return { read, write, edit };
}
