/**
 * Downcity SDK 的单 trial Node 入口。
 * 模型在宿主调用；terminal_exec 仅通过带 id 的 JSONL 请求 Python Harbor 环境。
 * 不创建 City、Workspace、宿主文件工具或宿主命令执行工具。
 */
import { Agent } from "@downcity/agent";
import { create_openai_compatible_model } from "@downcity/federation";
import type { AgentSession } from "@downcity/agent";
import type { ModelClient, ModelUsage, ModelStreamEvent } from "@downcity/type";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { format } from "node:util";
import type { CallRecord, ExecInput, ExecResult, InitMessage, PendingExec, UsageTotals } from "./types/bridge.js";

const max_frame_bytes = 2 * 1024 * 1024;
const max_trace_bytes = 64 * 1024 * 1024;
const root_abort = new AbortController();
const pending = new Map<string, PendingExec>();
const calls: CallRecord[] = [];
let session: AgentSession | undefined;
let init: InitMessage | undefined;
let tool_calls = 0;
let http_calls = 0;
let trace_bytes = 0;
let fatal_error: Error | undefined;
let closing = false;
let api_key = "";

/** 在所有写出边界抹去显式配置的模型密钥。 */
function redact(value: string): string {
  return api_key ? value.split(api_key).join("[REDACTED]") : value;
}

/** stdout 只用于机器协议；SDK 普通日志被导向 stderr。 */
function send(value: unknown): void {
  const line = redact(JSON.stringify(value)) + "\n";
  if (Buffer.byteLength(line) > max_frame_bytes) throw new Error("Outgoing bridge frame exceeds limit");
  process.stdout.write(line);
}
console.log = (...args: unknown[]) => process.stderr.write(redact(format(...args)) + "\n");
console.error = (...args: unknown[]) => process.stderr.write(redact(format(...args)) + "\n");
console.warn = console.error;

/** 写原生 JSONL 轨迹，达到证据容量上限时使本轮失败。 */
function trace(kind: string, data: unknown): void {
  if (!init) return;
  const line = redact(JSON.stringify({ time: new Date().toISOString(), kind, data })) + "\n";
  trace_bytes += Buffer.byteLength(line);
  if (trace_bytes > max_trace_bytes) throw new Error("Native trajectory exceeds 64 MiB limit");
  appendFileSync(join(init.logs_dir, "downcity-trajectory.jsonl"), line);
}

/** 任何硬边界失败都取消后续模型请求与等待命令。 */
function fail(error: unknown): void {
  fatal_error ??= new Error(redact(error instanceof Error ? error.message : String(error)));
  root_abort.abort(fatal_error);
  for (const [id, waiter] of pending) {
    send({ type: "cancel", id });
    waiter.dispose();
    waiter.reject(fatal_error);
  }
  pending.clear();
  void session?.stop().catch(() => undefined);
}

/** 对每项指标只汇总每个调用最后一份累计值；缺失时保持 unknown。 */
function usage_totals(): UsageTotals {
  const sum = (key: keyof ModelUsage): number | null => {
    if (calls.length === 0) return 0;
    let total = 0;
    for (const call of calls) {
      const value = call.usage_final ? call.usage?.[key] : undefined;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
      total += value;
    }
    return total;
  };
  return {
    input_tokens: sum("input_tokens"), output_tokens: sum("output_tokens"),
    cached_input_tokens: sum("cached_input_tokens"), cache_write_tokens: sum("cache_write_tokens"),
    reasoning_tokens: sum("reasoning_tokens"),
  };
}

/** 持续回填 Python AgentContext，保留中途被 Harbor 取消的计量证据。 */
function checkpoint(): void {
  send({ type: "checkpoint", usage: usage_totals(), model_calls: http_calls, tool_calls, calls });
}

/** 注入公开 ModelClient；所有用途的请求都经过同一额度与上下文边界。 */
function create_model(input: InitMessage): ModelClient {
  api_key = process.env.DOWNCITY_EVAL_API_KEY ?? "";
  const base_url = process.env.DOWNCITY_EVAL_BASE_URL ?? "";
  if (!api_key || !base_url) throw new Error("Set DOWNCITY_EVAL_API_KEY and DOWNCITY_EVAL_BASE_URL");
  const raw_context_window = process.env.DOWNCITY_EVAL_CONTEXT_WINDOW ?? "";
  const context_window = Number(raw_context_window);
  if (!/^\d+$/.test(raw_context_window) || !Number.isSafeInteger(context_window) || context_window < 1) {
    throw new Error("Set DOWNCITY_EVAL_CONTEXT_WINDOW to the verified model context window in tokens");
  }
  trace("model_metadata", { id: input.model_name, context_window });
  const endpoint = new URL(base_url);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Model base URL must be HTTP(S), without credentials, query or fragment");
  }
  const config = input.config;
  const upstream = create_openai_compatible_model({
    id: input.model_name, upstream_model: input.model_name, base_url, api_key,
    model_stream: { total_timeout_ms: Math.min(300, config.run_timeout_sec) * 1000 },
    // 额度落在真实 fetch 边界；SDK 的标题、压缩、恢复请求同样受限。
    fetch: async (request, options) => {
      if (closing || root_abort.signal.aborted) throw new Error("Runner is stopping");
      if (http_calls >= config.max_model_calls) {
        const error = new Error("max_model_calls reached"); fail(error); throw error;
      }
      http_calls += 1;
      checkpoint();
      const response = await fetch(request, { ...options, redirect: "error",
        signal: AbortSignal.any([root_abort.signal, ...(options?.signal ? [options.signal] : [])]) });
      if (!response.body) return response;
      let response_bytes = 0;
      const bounded_body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          response_bytes += chunk.byteLength;
          if (response_bytes > 4 * 1024 * 1024) {
            const error = new Error("Model HTTP response exceeds 4 MiB"); fail(error); throw error;
          }
          controller.enqueue(chunk);
        },
      }));
      return new Response(bounded_body, { status: response.status, statusText: response.statusText, headers: response.headers });
    },
  });
  return {
    id: upstream.id, context_window, model_stream_policy: upstream.model_stream_policy,
    async stream(call, signal) {
      if (closing || root_abort.signal.aborted) throw new Error("Runner is stopping");
      const bounded_call = { ...call, max_output_tokens: Math.min(call.max_output_tokens ?? config.max_output_tokens, config.max_output_tokens) };
      if (Buffer.byteLength(JSON.stringify(bounded_call)) > config.max_context_bytes) {
        const error = new Error("max_context_bytes reached before model request"); fail(error); throw error;
      }
      const record: CallRecord = { call_id: calls.length + 1, usage: null, usage_final: false, settled: false };
      calls.push(record);
      trace("model_call", { call_id: record.call_id, call: bounded_call });
      checkpoint();
      try {
        const stream = await upstream.stream(bounded_call, AbortSignal.any([root_abort.signal, ...(signal ? [signal] : [])]));
        const reader = stream.getReader();
        return new ReadableStream<ModelStreamEvent>({
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) {
                record.settled = true; checkpoint(); reader.releaseLock(); controller.close(); return;
              }
              if (next.value.type === "model_usage") record.usage = next.value.usage;
              if (next.value.type === "model_finish") record.usage_final = true;
              trace("model_event", { call_id: record.call_id, event: next.value });
              if (next.value.type === "model_usage" || next.value.type === "model_finish") checkpoint();
              controller.enqueue(next.value);
            } catch (error) {
              record.settled = true; checkpoint(); controller.error(error);
            }
          },
          async cancel(reason) {
            record.settled = true;
            await reader.cancel(reason).catch(() => undefined);
            checkpoint();
          },
        });
      } catch (error) {
        record.settled = true; checkpoint(); throw error;
      }
    },
  };
}

/** 发出容器命令请求；超时和 abort 都明确通知 Python 清理。 */
async function terminal_exec(input: ExecInput, signal?: AbortSignal): Promise<ExecResult> {
  if (!init || closing || root_abort.signal.aborted) throw new Error("Runner is stopping");
  const config = init.config;
  if (tool_calls >= config.max_tool_calls) {
    const error = new Error("max_tool_calls reached"); fail(error); throw error;
  }
  tool_calls += 1;
  checkpoint();
  if (typeof input.command !== "string" || !input.command || Buffer.byteLength(input.command) > 65536 || input.command.includes("\0")) {
    throw new Error("command must contain 1..65536 UTF-8 bytes without NUL");
  }
  const cwd = input.cwd ?? config.cwd;
  const timeout_sec = input.timeout_sec ?? config.command_timeout_sec;
  if (typeof cwd !== "string" || !cwd.startsWith("/") || cwd.includes("\0")) throw new Error("cwd must be a container absolute path");
  if (!Number.isInteger(timeout_sec) || timeout_sec < 1 || timeout_sec > config.command_timeout_sec) throw new Error("Invalid command timeout_sec");
  const id = randomUUID();
  const command_signal = AbortSignal.any([root_abort.signal, ...(signal ? [signal] : [])]);
  if (command_signal.aborted) throw new Error("Command cancelled before dispatch");
  trace("terminal_request", { id, command: input.command, cwd, timeout_sec });
  return await new Promise<ExecResult>((resolve, reject) => {
    const cancel = () => {
      send({ type: "cancel", id }); pending.get(id)?.dispose(); pending.delete(id);
      reject(new Error("Container command cancelled"));
    };
    const timer = setTimeout(() => {
      cancel(); fail(new Error("Container command bridge timeout"));
    }, (timeout_sec + 15) * 1000);
    pending.set(id, { resolve, reject, dispose: () => { clearTimeout(timer); command_signal.removeEventListener("abort", cancel); } });
    command_signal.addEventListener("abort", cancel, { once: true });
    send({ type: "exec", id, command: input.command, cwd, timeout_sec });
  });
}

/** 导出公共 messages() 的完整分页，避免只保存最终文字。 */
async function export_messages(): Promise<void> {
  if (!session || !init) return;
  let before_sequence: number | undefined;
  let total_bytes = 0;
  const file_path = join(init.logs_dir, "downcity-messages.jsonl");
  writeFileSync(file_path, "");
  do {
    const page = await session.messages({ limit: 100, ...(before_sequence ? { before_sequence } : {}) });
    const line = redact(JSON.stringify(page)) + "\n";
    total_bytes += Buffer.byteLength(line);
    if (total_bytes > max_trace_bytes) throw new Error("Canonical message export exceeds 64 MiB");
    appendFileSync(file_path, line);
    if (!page.has_more) break;
    if (!page.next_before_sequence || page.next_before_sequence === before_sequence) throw new Error("Invalid messages pagination");
    before_sequence = page.next_before_sequence;
  } while (true);
}

/** SDK 生命周期收口后才发送最终帧；外部取消允许 Python 兜底强制结束。 */
async function run(input: InitMessage): Promise<void> {
  let agent: Agent | undefined;
  let unsubscribe: (() => void) | undefined;
  let success = false;
  let final_text = "";
  const deadline = setTimeout(() => fail(new Error("run_timeout_sec reached")), input.config.run_timeout_sec * 1000);
  try {
    mkdirSync(input.logs_dir, { recursive: true });
    const build_info = JSON.parse(readFileSync(new URL("./build-info.json", import.meta.url), "utf8"));
    writeFileSync(join(input.logs_dir, "downcity-build-info.json"), JSON.stringify(build_info, null, 2) + "\n");
    trace("init", { model_name: input.model_name, config: input.config, methodology_comparable: false, protocol: "openai_chat_completions" });
    agent = new Agent({ id: `harbor-${randomUUID()}`, model: create_model(input),
      instruction: "Complete the task using terminal_exec in the task container. All task file reads, writes, searches and programs must use this tool. Paths and cwd refer only to the container. Commands are non-interactive; background processes may be terminated. Inspect return_code and truncated output. Finish with a concise report.",
      tools: { terminal_exec: {
        description: "Execute a non-interactive shell command in the Harbor task container. Use it for every task file operation.",
        input_schema: { type: "object", properties: {
          command: { type: "string", description: "Shell command in the task container" },
          cwd: { type: "string", description: `Container absolute directory; default ${input.config.cwd}` },
          timeout_sec: { type: "integer", minimum: 1, maximum: input.config.command_timeout_sec },
        }, required: ["command"], additionalProperties: false },
        execute: async (value, context) => await terminal_exec(value as ExecInput, context.abort_signal),
      } },
    });
    session = await agent.sessions.create();
    await session.rename("Harbor regex-log smoke");
    unsubscribe = session.subscribe((mutation) => { try { trace("mutation", mutation); } catch (error) { fail(error); } });
    const handle = await session.prompt({ query: input.instruction, abort_signal: root_abort.signal });
    const result = await handle.finished;
    final_text = result.text;
    success = result.success && !fatal_error;
    if (!result.success) fatal_error ??= new Error(redact(result.error ?? "SDK turn failed"));
  } catch (error) {
    fail(error);
  } finally {
    closing = true;
    root_abort.abort();
    try { await session?.stop(); } catch (error) { fail(error); }
    try { await export_messages(); } catch (error) { fail(error); }
    try { await agent?.dispose(); } catch (error) { fail(error); }
    unsubscribe?.();
    clearTimeout(deadline);
    const result = { type: "result", success: success && !fatal_error, error: fatal_error?.message,
      text: final_text, usage: usage_totals(), model_calls: http_calls, tool_calls,
      methodology_comparable: false, cost_usd: null, calls };
    writeFileSync(join(input.logs_dir, "downcity-result.json"), redact(JSON.stringify(result, null, 2)) + "\n");
    send(result);
    process.stdin.pause();
    process.exitCode = result.success ? 0 : 1;
  }
}

/** 有界逐行读取；损坏帧与重复 init 失败，已取消请求的迟到响应按 id 丢弃。 */
let buffer = Buffer.alloc(0);
let started = false;
process.stdin.on("data", (chunk: Buffer) => {
  try {
    buffer = Buffer.concat([buffer, chunk]);
    let newline: number;
    while ((newline = buffer.indexOf(10)) >= 0) {
      if (newline > max_frame_bytes) throw new Error("Incoming bridge frame exceeds limit");
      const line = buffer.subarray(0, newline).toString("utf8"); buffer = buffer.subarray(newline + 1);
      const message = JSON.parse(line);
      if (!started) {
        if (message.type !== "init" || !message.config || typeof message.logs_dir !== "string") throw new Error("Expected init frame");
        started = true; init = message as InitMessage;
        void run(init).catch((error) => { fail(error); process.exitCode = 1; process.stdin.pause(); });
      } else if (message.type === "exec_result") {
        const waiter = pending.get(message.id);
        // 已主动取消的请求可能有迟到响应，按 id 安全丢弃。
        if (!waiter) continue;
        waiter.dispose(); pending.delete(message.id);
        trace("terminal_result", message);
        if (typeof message.error === "string") {
          const error = new Error(message.error); waiter.reject(error); fail(error);
        }
        else if (message.result && typeof message.result.stdout === "string" && typeof message.result.stderr === "string" && Number.isInteger(message.result.return_code)) waiter.resolve(message.result);
        else waiter.reject(new Error("Invalid exec_result frame"));
      } else throw new Error("Unknown bridge message type");
    }
    if (buffer.length > max_frame_bytes) throw new Error("Incoming bridge frame exceeds limit");
  } catch (error) { fail(error); if (!started) { process.exitCode = 1; process.stdin.pause(); } }
});
process.stdin.on("end", () => { if (!closing) fail(new Error("Python bridge closed stdin")); });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => fail(new Error(`Runner received ${signal}`)));
process.stdout.on("error", () => { root_abort.abort(); process.exit(1); });
