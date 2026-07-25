/**
 * MemoryPlugin：agent 的长期记忆 plugin。
 *
 * 关键点（中文）
 * - 对外仍然是 MemoryPlugin，内部使用 LLM Wiki 方式组织知识。
 * - constructor 注入 digest/revise 能力，plugin 不绑定具体 LLM 服务。
 * - action 面向 agent 语义，而不是暴露底层文件写入细节。
 */

import type { Command } from "commander";
import type { JsonObject, JsonValue } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
import type { PluginActions } from "@downcity/agent";
import { BasePlugin } from "@downcity/agent";
import { create_action } from "@downcity/agent";
import { z } from "zod";
import {
  digestMemoryAction,
  readMemoryAction,
  rememberMemoryAction,
  reviseMemoryAction,
  searchMemoryAction,
  statusMemoryAction,
} from "./Action.js";
import {
  createMemoryRuntimeState,
  type MemoryRuntimeState,
} from "./runtime/Store.js";
import { buildMemoryPluginSystemText } from "./runtime/SystemProvider.js";
import { ensureMemoryDirectories } from "./runtime/Writer.js";
import type { MemoryPluginOptions } from "./types/Memory.js";

function parsePositiveInteger(value: string): number {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  const num = Number(text);
  if (!Number.isFinite(num) || num < 1) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  return num;
}

function parseNumber(value: string): number {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error("number is required");
  }
  const num = Number(text);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return num;
}

function readBodyObject(rawBody: JsonValue): JsonObject {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return {};
  }
  return rawBody as JsonObject;
}

function readString(body: JsonObject, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function readOptionalString(body: JsonObject, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

function readOptionalNumber(body: JsonObject, key: string): number | undefined {
  const value = body[key];
  return typeof value === "number" ? value : undefined;
}

function readOptionalBoolean(body: JsonObject, key: string): boolean | undefined {
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Memory plugin 类实现。
 */
export class MemoryPlugin extends BasePlugin {
  /**
   * plugin 名称。
   */
  readonly name = "memory";

  /**
   * 当前实例持有的 memory plugin state。
   */
  public runtimeState: MemoryRuntimeState | null = null;

  /**
   * 创建 MemoryPlugin。
   */
  constructor(private readonly options: MemoryPluginOptions = {}) {
    super();
  }

  /**
   * 当前 plugin 的 system 文本提供器。
   */
  async system(context: PluginContext): Promise<string> {
    return await buildMemoryPluginSystemText(context);
  }

  /**
   * 当前 plugin 生命周期。
   */
  readonly lifecycle = {
    start: async (context: PluginContext): Promise<void> => {
      await ensureMemoryDirectories(context.workspace_path);
      this.getOrCreateRuntimeState(context);
    },
    stop: async (): Promise<void> => {
      this.runtimeState = null;
    },
  };

  /**
   * 当前 plugin action 定义表。
   */
  readonly actions: PluginActions = {
    status: create_action({
      description: "View memory wiki status (wiki/source/working).",
      input_schema: {
        zod: z.object({}).passthrough(),
        json_schema: { type: "object", properties: {} },
      },
      examples: [{ title: "View status", payload: {} }],
      command: {
        description: "View memory wiki status (wiki/source/working).",
        map_input() {
          return {};
        },
      },
      execute: async (params) => {
        const state = this.getOrCreateRuntimeState(params.context);
        return await statusMemoryAction(params.context, state);
      },
    }),
    search: create_action({
      description: "Search memory wiki, optionally extending into the source layer.",
      input_schema: {
        zod: z.object({
          query: z.string(),
          maxResults: z.number().optional(),
          minScore: z.number().optional(),
          includeSources: z.boolean().optional(),
        }),
        json_schema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", description: "Search query." },
            maxResults: { type: "number", description: "Maximum number of results." },
            minScore: { type: "number", description: "Minimum relevance score." },
            includeSources: { type: "boolean", description: "Whether to include the source layer." },
          },
        },
      },
      examples: [
        { title: "Search memory", payload: { query: "user preferences" } },
      ],
      command: {
        description: "Search memory wiki.",
        configure(command: Command) {
          command
            .argument("<query>")
            .option("--max-results <number>", "Maximum number of results.", parsePositiveInteger)
            .option("--min-score <number>", "Minimum relevance score.", parseNumber)
            .option("--include-sources", "Also search the raw source layer.");
        },
        map_input({ args, opts }) {
          const payload: JsonObject = {
            query: String(args[0] || ""),
          };
          if (typeof opts.maxResults === "number") {
            payload.maxResults = opts.maxResults;
          }
          if (typeof opts.minScore === "number") {
            payload.minScore = opts.minScore;
          }
          if (opts.includeSources === true) {
            payload.includeSources = true;
          }
          return payload;
        },
      },
      execute: async (params) => {
        const body = readBodyObject(params.input);
        const state = this.getOrCreateRuntimeState(params.context);
        return await searchMemoryAction(params.context, state, {
          query: readString(body, "query"),
          maxResults: readOptionalNumber(body, "maxResults"),
          minScore: readOptionalNumber(body, "minScore"),
          includeSources: readOptionalBoolean(body, "includeSources"),
        });
      },
    }),
    read: create_action({
      description: "Read a memory wiki/source file excerpt.",
      input_schema: {
        zod: z.object({
          path: z.string(),
          from: z.number().optional(),
          lines: z.number().optional(),
        }),
        json_schema: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string", description: "Memory file path relative to the project root." },
            from: { type: "number", description: "Starting line, 1-based." },
            lines: { type: "number", description: "Number of lines to read." },
          },
        },
      },
      examples: [
        { title: "Read full page", payload: { path: ".downcity/memory/wiki/index.md" } },
      ],
      command: {
        description: "Read a memory wiki/source file excerpt.",
        configure(command: Command) {
          command
            .argument("<memoryPath>", "Memory file path relative to the project root.")
            .option("--from <number>", "Starting line, 1-based.", parsePositiveInteger)
            .option("--lines <number>", "Number of lines to read.", parsePositiveInteger);
        },
        map_input({ args, opts }) {
          const payload: JsonObject = {
            path: String(args[0] || ""),
          };
          if (typeof opts.from === "number") {
            payload.from = opts.from;
          }
          if (typeof opts.lines === "number") {
            payload.lines = opts.lines;
          }
          return payload;
        },
      },
      execute: async (params) => {
        const body = readBodyObject(params.input);
        return await readMemoryAction(params.context, {
          path: readString(body, "path"),
          from: readOptionalNumber(body, "from"),
          lines: readOptionalNumber(body, "lines"),
        });
      },
    }),
    remember: create_action({
      description: "Record facts, preferences, or decisions into memory wiki.",
      input_schema: {
        zod: z.object({
          content: z.string(),
          topic: z.string().optional(),
          path: z.string().optional(),
          source: z.string().optional(),
        }),
        json_schema: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", description: "Content to remember." },
            topic: { type: "string", description: "Memory topic." },
            path: { type: "string", description: "Target wiki page path." },
            source: { type: "string", description: "Source note." },
          },
        },
      },
      examples: [
        { title: "Remember preference", payload: { content: "User prefers concise answers", topic: "user-prefs" } },
      ],
      command: {
        description: "Record facts, preferences, or decisions into memory wiki.",
        configure(command: Command) {
          command
            .requiredOption("--content <text>", "Content to remember.")
            .option("--topic <topic>", "Memory topic.")
            .option("--wiki-path <path>", "Target wiki page path.")
            .option("--source <source>", "Source note.");
        },
        map_input({ opts }) {
          const payload: JsonObject = {
            content: String(opts.content || ""),
          };
          if (typeof opts.topic === "string") {
            payload.topic = String(opts.topic).trim();
          }
          if (typeof opts.wikiPath === "string") {
            payload.path = String(opts.wikiPath).trim();
          }
          if (typeof opts.source === "string") {
            payload.source = String(opts.source).trim();
          }
          return payload;
        },
      },
      execute: async (params) => {
        const body = readBodyObject(params.input);
        return await rememberMemoryAction(params.context, this.options, {
          content: readString(body, "content"),
          topic: readOptionalString(body, "topic"),
          path: readOptionalString(body, "path"),
          source: readOptionalString(body, "source"),
        });
      },
    }),
    digest: create_action({
      description: "Digest a session into memory wiki.",
      input_schema: {
        zod: z.object({
          session_id: z.string(),
          maxMessages: z.number().optional(),
        }),
        json_schema: {
          type: "object",
          required: ["session_id"],
          properties: {
            session_id: { type: "string", description: "Session ID." },
            maxMessages: { type: "number", description: "Message extraction window." },
          },
        },
      },
      examples: [
        { title: "Digest session", payload: { session_id: "sess-1" } },
      ],
      command: {
        description: "Digest a session into memory wiki.",
        configure(command: Command) {
          command
            .requiredOption("--session-id <session_id>", "Session ID.")
            .option("--max-messages <number>", "Message extraction window.", parsePositiveInteger);
        },
        map_input({ opts }) {
          const payload: JsonObject = {
            session_id: String(opts.session_id || ""),
          };
          if (typeof opts.maxMessages === "number") {
            payload.maxMessages = opts.maxMessages;
          }
          return payload;
        },
      },
      execute: async (params) => {
        const body = readBodyObject(params.input);
        return await digestMemoryAction(params.context, this.options, {
          session_id: readString(body, "session_id"),
          maxMessages: readOptionalNumber(body, "maxMessages"),
        });
      },
    }),
    revise: create_action({
      description: "Revise a memory wiki page based on new evidence.",
      input_schema: {
        zod: z.object({
          path: z.string(),
          instruction: z.string(),
          evidence: z.string().optional(),
        }),
        json_schema: {
          type: "object",
          required: ["path", "instruction"],
          properties: {
            path: { type: "string", description: "Target wiki page path." },
            instruction: { type: "string", description: "Revision instruction." },
            evidence: { type: "string", description: "New evidence." },
          },
        },
      },
      examples: [
        {
          title: "Revise entry",
          payload: { path: "wiki/preferences.md", instruction: "Replace with latest preference." },
        },
      ],
      command: {
        description: "Revise a memory wiki page based on new evidence.",
        configure(command: Command) {
          command
            .argument("<memoryPath>", "Target wiki page path.")
            .requiredOption("--instruction <text>", "Revision instruction.")
            .option("--evidence <text>", "New evidence.");
        },
        map_input({ args, opts }) {
          const payload: JsonObject = {
            path: String(args[0] || ""),
            instruction: String(opts.instruction || ""),
          };
          if (typeof opts.evidence === "string") {
            payload.evidence = String(opts.evidence).trim();
          }
          return payload;
        },
      },
      execute: async (params) => {
        const body = readBodyObject(params.input);
        return await reviseMemoryAction(params.context, this.options, {
          path: readString(body, "path"),
          instruction: readString(body, "instruction"),
          evidence: readOptionalString(body, "evidence"),
        });
      },
    }),
  };

  /**
   * 获取或创建当前实例绑定的 memory plugin state。
   */
  private getOrCreateRuntimeState(context: PluginContext): MemoryRuntimeState {
    if (!this.runtimeState) {
      this.runtimeState = createMemoryRuntimeState(context);
    }
    return this.runtimeState;
  }
}
