/**
 * 项目搜索 AI SDK tools。
 *
 * 关键点（中文）
 * - 模型通过独立的 `grep` / `find` 工具搜索内容和发现文件。
 * - 工具只负责 schema、abort signal 与 action 转发，搜索语义由运行时实现。
 */

import { tool, type ToolExecutionOptions } from "ai";
import type { ActionResult } from "@/types/action/ActionResult.js";
import type {
  FindToolInput,
  FindToolResult,
  GrepToolInput,
  GrepToolResult,
  SearchToolRunner,
  SearchToolSet,
} from "@/types/workspace/SearchTool.js";
import {
  find_tool_input_schema,
  grep_tool_input_schema,
} from "@/workspace/tool/SearchToolSchemas.js";

/** 创建 Workspace 持有的结构化搜索工具。 */
export function create_search_tools(runner: SearchToolRunner): SearchToolSet {
  const grep = tool({
    description:
      "Search project file contents with ripgrep instead of running rg through the shell. Returns structured file, line, column, and matched text data; respects ignore files by default.",
    inputSchema: grep_tool_input_schema,
    execute: async (
      input: GrepToolInput,
      options: ToolExecutionOptions,
    ): Promise<ActionResult<GrepToolResult>> => {
      const output = await runner.run_search_action({
        action: "grep",
        input,
        abort_signal: options.abortSignal,
      }) as GrepToolResult;
      return { output, messages: [] };
    },
  });

  const find = tool({
    description:
      "Find project files with a POSIX glob pattern instead of running shell find. Respects .gitignore, includes dotfiles, and does not follow symbolic links.",
    inputSchema: find_tool_input_schema,
    execute: async (
      input: FindToolInput,
      options: ToolExecutionOptions,
    ): Promise<ActionResult<FindToolResult>> => {
      const output = await runner.run_search_action({
        action: "find",
        input,
        abort_signal: options.abortSignal,
      }) as FindToolResult;
      return { output, messages: [] };
    },
  });

  return { grep, find };
}
