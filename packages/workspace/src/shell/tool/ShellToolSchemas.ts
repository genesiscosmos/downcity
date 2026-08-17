/**
 * Shell tool 输入 schema。
 *
 * 关键点（中文）
 * - 所有 schema 统一集中，避免 `Tool.ts` 里同时混杂协议定义与执行逻辑。
 * - 这里保持纯声明，不放任何运行时桥接细节。
 */

import { z } from "zod";

const shellSandboxModeSchema = z
  .enum(["safe", "unrestricted"])
  .optional()
  .default("safe")
  .describe("Sandbox mode. safe is the default; unrestricted requires user approval.");

const shellUnrestrictedReasonSchema = z
  .string()
  .optional()
  .describe("Required when sandbox is unrestricted. Explain why host-level execution is needed.");

const shellSessionActionSchema = z
  .enum(["start", "send", "read", "list", "stop"])
  .describe("Session action: start, send input, read latest output, list sessions, or stop.");

export const shellSessionInputSchema = z.object({
  action: shellSessionActionSchema,
  cmd: z.string().optional().describe("Shell command to execute when action=start."),
  shell_id: z.string().optional().describe("Existing shell session identifier."),
  input: z.string().optional().describe("Text to send to the PTY session."),
  workdir: z
    .string()
    .optional()
    .describe("Optional working directory. Relative path is resolved from project root."),
  shell: z
    .string()
    .optional()
    .describe("Optional shell executable path. Example: /bin/zsh or C:\\Windows\\System32\\cmd.exe"),
  login: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether POSIX shells use -lc instead of -c. Ignored by the Windows cmd model."),
  inline_wait_ms: z
    .number()
    .optional()
    .default(1200)
    .describe("How long to wait after start/send/read before returning output."),
  wait_ms: z
    .number()
    .optional()
    .describe("Alias for inline_wait_ms when sending or reading session output."),
  max_output_tokens: z
    .number()
    .optional()
    .describe("Maximum output tokens returned in a single read chunk."),
  include_completed: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether list should include completed sessions."),
  auto_notify_on_exit: z
    .boolean()
    .optional()
    .describe("Whether the shell runtime should emit a completion notification when the command exits."),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether stop should force-kill the session."),
  cols: z
    .number()
    .optional()
    .describe("PTY columns for start. Defaults to 120."),
  rows: z
    .number()
    .optional()
    .describe("PTY rows for start. Defaults to 40."),
  sandbox: shellSandboxModeSchema,
  reason: shellUnrestrictedReasonSchema,
});

export const shellExecInputSchema = z.object({
  cmd: z.string().describe("Shell command to execute once and wait until completion."),
  workdir: z
    .string()
    .optional()
    .describe("Optional working directory. Relative path is resolved from project root."),
  shell: z
    .string()
    .optional()
    .describe("Optional shell executable path. Example: /bin/zsh or C:\\Windows\\System32\\cmd.exe"),
  login: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether POSIX shells use -lc instead of -c. Ignored by the Windows cmd model."),
  timeout_ms: z
    .number()
    .optional()
    .default(600000)
    .describe("Total timeout for one-shot execution. Defaults to 10 minutes; shell_session is preferred for long-running commands."),
  max_output_tokens: z
    .number()
    .optional()
    .describe("Maximum output tokens returned in the final result."),
  sandbox: shellSandboxModeSchema,
  reason: shellUnrestrictedReasonSchema,
});
