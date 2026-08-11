/**
 * MemoryPlugin：Agent 长期记忆的 provider-neutral facade。
 *
 * 职责说明（中文）
 * - 对 Agent 暴露稳定的 Memory actions 与 system 使用约束。
 * - 把 Agent/Session 上下文映射为结构化 Memory scope。
 * - 将记忆形成、存储、召回、修订和删除委托给唯一 MemoryProvider。
 *
 * 边界说明（中文）
 * - 不读取或拼接任何物理存储路径。
 * - 不依赖 Workspace FileSystem，也不规定 Markdown、SQLite 或远程服务。
 * - Provider 生命周期跟随当前 Plugin 实例，由 Agent 统一启动和释放。
 */

import type { Command } from "commander";
import { BasePlugin, create_action } from "@downcity/agent";
import type {
  JsonObject,
  JsonValue,
  PluginActions,
  PluginContext,
} from "@downcity/agent";
import { z } from "zod";
import {
  digest_memory_action,
  forget_memory_action,
  read_memory_action,
  remember_memory_action,
  revise_memory_action,
  search_memory_action,
  status_memory_action,
} from "@/memory/Action.js";
import { build_memory_plugin_system_text } from "@/memory/runtime/SystemProvider.js";
import type {
  MemoryPluginOptions,
  MemoryProvider,
  MemoryType,
} from "@/memory/types/Memory.js";

const memory_type_schema = z.enum([
  "fact",
  "preference",
  "decision",
  "episode",
  "procedure",
  "document",
]);

/** 解析正整数 CLI 参数。 */
function parse_positive_integer(value: string): number {
  const text = String(value || "").trim();
  if (!/^\d+$/u.test(text)) throw new Error(`Invalid positive integer: ${value}`);
  const number_value = Number(text);
  if (!Number.isFinite(number_value) || number_value < 1) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  return number_value;
}

/** 解析任意有限数值 CLI 参数。 */
function parse_number(value: string): number {
  const number_value = Number(String(value || "").trim());
  if (!Number.isFinite(number_value)) throw new Error(`Invalid number: ${value}`);
  return number_value;
}

/** 把 Action JSON 输入归一化为普通对象。 */
function read_body_object(raw_body: JsonValue): JsonObject {
  return raw_body && typeof raw_body === "object" && !Array.isArray(raw_body)
    ? raw_body as JsonObject
    : {};
}

/** 读取必填或可选字符串字段。 */
function read_string(body: JsonObject, key: string): string {
  return typeof body[key] === "string" ? String(body[key]) : "";
}

/** 读取可选字符串字段。 */
function read_optional_string(body: JsonObject, key: string): string | undefined {
  const value = read_string(body, key).trim();
  return value || undefined;
}

/** 读取可选数值字段。 */
function read_optional_number(body: JsonObject, key: string): number | undefined {
  return typeof body[key] === "number" ? Number(body[key]) : undefined;
}

/** 读取可选布尔字段。 */
function read_optional_boolean(body: JsonObject, key: string): boolean | undefined {
  return typeof body[key] === "boolean" ? Boolean(body[key]) : undefined;
}

/** 读取可选 MemoryType 字段。 */
function read_optional_memory_type(body: JsonObject): MemoryType | undefined {
  const result = memory_type_schema.safeParse(body.memory_type);
  return result.success ? result.data : undefined;
}

/** Agent 长期记忆 Plugin。 */
export class MemoryPlugin extends BasePlugin {
  /** Plugin 稳定名称。 */
  readonly name = "memory";

  /** 当前 Plugin 唯一绑定的 Memory Provider。 */
  readonly provider: MemoryProvider;

  constructor(options: MemoryPluginOptions) {
    super();
    if (!options?.provider) throw new Error("MemoryPlugin requires provider");
    const provider_name = String(options.provider.name || "").trim();
    if (!provider_name) throw new Error("MemoryPlugin provider requires name");
    this.provider = options.provider;
  }

  /** 构建 provider-neutral Memory system 内容。 */
  async system(context: PluginContext): Promise<string> {
    return await build_memory_plugin_system_text(context, this.provider);
  }

  /** Provider 生命周期与当前 Agent Plugin 实例保持一致。 */
  readonly lifecycle = {
    start: async (context: PluginContext): Promise<void> => {
      await this.provider.initialize({
        agent_id: context.agent_id,
      });
    },
    stop: async (): Promise<void> => {
      await this.provider.dispose();
    },
  };

  /** Memory 对 Agent 暴露的稳定 Action 集合。 */
  readonly actions: PluginActions = {
    status: create_action({
      description: "Inspect the active Memory Provider and its capabilities.",
      input_schema: {
        zod: z.object({}).passthrough(),
        json_schema: { type: "object", additionalProperties: false, properties: {} },
      },
      examples: [{ title: "View Memory Provider status", payload: {} }],
      command: {
        description: "Inspect the active Memory Provider.",
        map_input: () => ({}),
      },
      execute: async () => await status_memory_action(this.provider),
    }),

    search: create_action({
      description: "Recall scoped long-term memories for a focused query.",
      input_schema: {
        zod: z.object({
          query: z.string(),
          max_results: z.number().optional(),
          min_score: z.number().optional(),
          include_evidence: z.boolean().optional(),
        }),
        json_schema: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: {
            query: { type: "string", description: "Focused recall query." },
            max_results: { type: "number", description: "Maximum result count." },
            min_score: { type: "number", minimum: 0, maximum: 1 },
            include_evidence: { type: "boolean", description: "Include raw evidence records." },
          },
        },
      },
      examples: [{ title: "Recall preferences", payload: { query: "user preferences" } }],
      command: {
        description: "Recall scoped long-term memories.",
        configure(command: Command) {
          command
            .argument("<query>")
            .option("--max-results <number>", "Maximum result count.", parse_positive_integer)
            .option("--min-score <number>", "Minimum relevance score.", parse_number)
            .option("--include-evidence", "Include raw evidence records.");
        },
        map_input({ args, opts }) {
          return {
            query: String(args[0] || ""),
            ...(typeof opts.maxResults === "number" ? { max_results: opts.maxResults } : {}),
            ...(typeof opts.minScore === "number" ? { min_score: opts.minScore } : {}),
            ...(opts.includeEvidence === true ? { include_evidence: true } : {}),
          };
        },
      },
      execute: async ({ context, input }) => {
        const body = read_body_object(input);
        return await search_memory_action(context, this.provider, {
          query: read_string(body, "query"),
          max_results: read_optional_number(body, "max_results"),
          min_score: read_optional_number(body, "min_score"),
          include_evidence: read_optional_boolean(body, "include_evidence"),
        });
      },
    }),

    read: create_action({
      description: "Read one exact memory by memory_id.",
      input_schema: {
        zod: z.object({
          memory_id: z.string(),
          from_line: z.number().optional(),
          line_count: z.number().optional(),
        }),
        json_schema: {
          type: "object",
          additionalProperties: false,
          required: ["memory_id"],
          properties: {
            memory_id: { type: "string", description: "Stable logical memory identifier." },
            from_line: { type: "number", minimum: 1 },
            line_count: { type: "number", minimum: 1 },
          },
        },
      },
      examples: [{ title: "Read a memory", payload: { memory_id: "wiki/user-preferences" } }],
      command: {
        description: "Read one exact memory.",
        configure(command: Command) {
          command
            .argument("<memory_id>")
            .option("--from-line <number>", "Starting line, 1-based.", parse_positive_integer)
            .option("--line-count <number>", "Maximum line count.", parse_positive_integer);
        },
        map_input({ args, opts }) {
          return {
            memory_id: String(args[0] || ""),
            ...(typeof opts.fromLine === "number" ? { from_line: opts.fromLine } : {}),
            ...(typeof opts.lineCount === "number" ? { line_count: opts.lineCount } : {}),
          };
        },
      },
      execute: async ({ context, input }) => {
        const body = read_body_object(input);
        return await read_memory_action(context, this.provider, {
          memory_id: read_string(body, "memory_id"),
          from_line: read_optional_number(body, "from_line"),
          line_count: read_optional_number(body, "line_count"),
        });
      },
    }),

    remember: create_action({
      description: "Store a durable fact, preference, decision, episode, procedure, or document.",
      input_schema: {
        zod: z.object({
          content: z.string(),
          topic: z.string().optional(),
          memory_type: memory_type_schema.optional(),
          source: z.string().optional(),
        }),
        json_schema: {
          type: "object",
          additionalProperties: false,
          required: ["content"],
          properties: {
            content: { type: "string", description: "Content to remember." },
            topic: { type: "string", description: "Optional organization hint." },
            memory_type: {
              type: "string",
              enum: ["fact", "preference", "decision", "episode", "procedure", "document"],
            },
            source: { type: "string", description: "Optional evidence label." },
          },
        },
      },
      examples: [{
        title: "Remember a preference",
        payload: {
          content: "User prefers concise answers.",
          topic: "user-preferences",
          memory_type: "preference",
        },
      }],
      command: {
        description: "Store a durable memory.",
        configure(command: Command) {
          command
            .requiredOption("--content <text>", "Content to remember.")
            .option("--topic <topic>", "Optional organization hint.")
            .option("--memory-type <type>", "Memory type.")
            .option("--source <source>", "Optional evidence label.");
        },
        map_input({ opts }) {
          return {
            content: String(opts.content || ""),
            ...(typeof opts.topic === "string" ? { topic: opts.topic } : {}),
            ...(typeof opts.memoryType === "string" ? { memory_type: opts.memoryType } : {}),
            ...(typeof opts.source === "string" ? { source: opts.source } : {}),
          };
        },
      },
      execute: async ({ context, input }) => {
        const body = read_body_object(input);
        return await remember_memory_action(context, this.provider, {
          content: read_string(body, "content"),
          topic: read_optional_string(body, "topic"),
          memory_type: read_optional_memory_type(body),
          source: read_optional_string(body, "source"),
        });
      },
    }),

    digest: create_action({
      description: "Digest a canonical Session transcript into long-term memory.",
      input_schema: {
        zod: z.object({
          session_id: z.string(),
          max_messages: z.number().optional(),
        }),
        json_schema: {
          type: "object",
          additionalProperties: false,
          required: ["session_id"],
          properties: {
            session_id: { type: "string" },
            max_messages: { type: "number", minimum: 1 },
          },
        },
      },
      examples: [{ title: "Digest a Session", payload: { session_id: "sess-1" } }],
      command: {
        description: "Digest a canonical Session transcript.",
        configure(command: Command) {
          command
            .requiredOption("--session-id <session_id>", "Session identifier.")
            .option("--max-messages <number>", "Maximum message count.", parse_positive_integer);
        },
        map_input({ opts }) {
          return {
            session_id: String(opts.sessionId || ""),
            ...(typeof opts.maxMessages === "number" ? { max_messages: opts.maxMessages } : {}),
          };
        },
      },
      execute: async ({ context, input }) => {
        const body = read_body_object(input);
        return await digest_memory_action(context, this.provider, {
          session_id: read_string(body, "session_id"),
          max_messages: read_optional_number(body, "max_messages"),
        });
      },
    }),

    revise: create_action({
      description: "Revise one memory using new evidence.",
      input_schema: {
        zod: z.object({
          memory_id: z.string(),
          instruction: z.string(),
          evidence: z.string().optional(),
        }),
        json_schema: {
          type: "object",
          additionalProperties: false,
          required: ["memory_id", "instruction"],
          properties: {
            memory_id: { type: "string" },
            instruction: { type: "string" },
            evidence: { type: "string" },
          },
        },
      },
      examples: [{
        title: "Revise a preference",
        payload: {
          memory_id: "wiki/user-preferences",
          instruction: "Replace the old preference with the latest one.",
        },
      }],
      command: {
        description: "Revise one memory using new evidence.",
        configure(command: Command) {
          command
            .argument("<memory_id>")
            .requiredOption("--instruction <text>", "Revision instruction.")
            .option("--evidence <text>", "New evidence.");
        },
        map_input({ args, opts }) {
          return {
            memory_id: String(args[0] || ""),
            instruction: String(opts.instruction || ""),
            ...(typeof opts.evidence === "string" ? { evidence: opts.evidence } : {}),
          };
        },
      },
      execute: async ({ context, input }) => {
        const body = read_body_object(input);
        return await revise_memory_action(context, this.provider, {
          memory_id: read_string(body, "memory_id"),
          instruction: read_string(body, "instruction"),
          evidence: read_optional_string(body, "evidence"),
        });
      },
    }),

    forget: create_action({
      description: "Delete or invalidate one memory by memory_id.",
      input_schema: {
        zod: z.object({ memory_id: z.string() }),
        json_schema: {
          type: "object",
          additionalProperties: false,
          required: ["memory_id"],
          properties: { memory_id: { type: "string" } },
        },
      },
      examples: [{ title: "Forget a memory", payload: { memory_id: "wiki/obsolete" } }],
      command: {
        description: "Delete or invalidate one memory.",
        configure(command: Command) {
          command.argument("<memory_id>");
        },
        map_input({ args }) {
          return { memory_id: String(args[0] || "") };
        },
      },
      execute: async ({ context, input }) => {
        const body = read_body_object(input);
        return await forget_memory_action(context, this.provider, {
          memory_id: read_string(body, "memory_id"),
        });
      },
    }),
  };
}
