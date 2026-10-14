/**
 * MemoryPower：Agent 长期记忆的 provider-neutral facade。
 *
 * 职责说明（中文）
 * - 对 Agent 暴露稳定的 Memory actions 与 system 使用约束。
 * - 把可信 Agent/Session 上下文映射为结构化 Memory 访问上下文。
 * - 将记忆形成、存储、召回、修订和删除委托给唯一 MemoryProvider。
 *
 * 边界说明（中文）
 * - 只接受宿主显式提供的 Agent/City Memory 根路径，不猜测 City 上级目录。
 * - 不依赖 Workspace FileSystem；具体文件布局仍封装在 Provider/Adapter 内。
 * - Provider 生命周期跟随 City 持有的 MemoryPower 唯一实例。
 */

import type { Command } from "commander";
import path from "node:path";
import { Power, create_action } from "@downcity/city/power";
import type {
  PowerJsonObject,
  PowerJsonValue,
  PowerHooks,
  PowerActions,
  PowerContext,
  PowerLifecycleContext,
} from "@downcity/city/power";
import type {
  SessionTurnCommittedHookValue,
  SessionTurnContextHookValue,
} from "@downcity/agent";
import { SESSION_HOOK_POINTS } from "@downcity/type";
import { z } from "zod";
import {
  digest_memory_action,
  forget_memory_action,
  list_memory_action,
  read_memory_action,
  remember_memory_action,
  revise_memory_action,
  search_memory_action,
  status_memory_action,
} from "@/memory/Action.js";
import { build_memory_power_system_text } from "@/memory/runtime/SystemProvider.js";
import { AutomaticMemory } from "@/memory/runtime/AutomaticMemory.js";
import type { AutomaticMemoryOptions } from "@/memory/types/AutomaticMemory.js";
import { BuiltinMemoryProvider } from "@/memory/providers/BuiltinMemoryProvider.js";
import {
  FileMemoryStorageAdapter,
  get_default_file_memory_root_path,
} from "@/memory/adapters/FileMemoryStorageAdapter.js";
import { MemoryStorageRouter } from "@/memory/adapters/MemoryStorageRouter.js";

import { resolve_memory_access } from "@/memory/runtime/AccessResolver.js";
import { register_memory_power_host_actions } from "@/memory/host/MemoryPowerHostActions.js";
import type {
  MemoryPowerOptions,
  MemoryProvider,
  MemoryType,
} from "@/memory/types/Memory.js";
import type {
  MemorySubjectKind,
  MemoryWriteTarget,
} from "@/memory/types/MemoryAccess.js";

const memory_type_schema = z.enum([
  "fact",
  "preference",
  "decision",
  "episode",
  "procedure",
  "document",
]);

const memory_write_target_schema = z.enum([
  "current_workspace", "user", "agent",
]);

const memory_subject_kind_schema = z.enum([
  "agent", "user", "workspace", "city",
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

/** 解析非负整数 CLI 参数。 */
function parse_non_negative_integer(value: string): number {
  const text = String(value || "").trim();
  if (!/^\d+$/u.test(text)) throw new Error(`Invalid non-negative integer: ${value}`);
  return Number(text);
}

/** 解析任意有限数值 CLI 参数。 */
function parse_number(value: string): number {
  const number_value = Number(String(value || "").trim());
  if (!Number.isFinite(number_value)) throw new Error(`Invalid number: ${value}`);
  return number_value;
}

/** 把 Action JSON 输入归一化为普通对象。 */
function read_body_object(raw_body: PowerJsonValue): PowerJsonObject {
  return raw_body && typeof raw_body === "object" && !Array.isArray(raw_body)
    ? raw_body as PowerJsonObject
    : {};
}

/** 读取必填或可选字符串字段。 */
function read_string(body: PowerJsonObject, key: string): string {
  return typeof body[key] === "string" ? String(body[key]) : "";
}

/** 读取可选字符串字段。 */
function read_optional_string(body: PowerJsonObject, key: string): string | undefined {
  const value = read_string(body, key).trim();
  return value || undefined;
}

/** 读取可选数值字段。 */
function read_optional_number(body: PowerJsonObject, key: string): number | undefined {
  return typeof body[key] === "number" ? Number(body[key]) : undefined;
}

/** 读取可选布尔字段。 */
function read_optional_boolean(body: PowerJsonObject, key: string): boolean | undefined {
  return typeof body[key] === "boolean" ? Boolean(body[key]) : undefined;
}

/** 读取可选 MemoryType 字段。 */
function read_optional_memory_type(body: PowerJsonObject): MemoryType | undefined {
  const result = memory_type_schema.safeParse(body.memory_type);
  return result.success ? result.data : undefined;
}

/** 读取必填 Memory 写入目标。 */
function read_memory_write_target(body: PowerJsonObject): MemoryWriteTarget {
  const result = memory_write_target_schema.safeParse(body.target);
  if (!result.success) throw new Error("Memory remember requires target");
  return result.data;
}

/** 读取可选 MemoryType 列表字段。 */
function read_optional_memory_type_list(body: PowerJsonObject): MemoryType[] | undefined {
  if (!Array.isArray(body.memory_types)) return undefined;
  return body.memory_types
    .map((value) => memory_type_schema.safeParse(value))
    .flatMap((result) => (result.success ? [result.data] : []));
}

/** 读取可选 Subject 类别列表字段。 */
function read_optional_subject_kind_list(body: PowerJsonObject): MemorySubjectKind[] | undefined {
  if (!Array.isArray(body.subject_kinds)) return undefined;
  return body.subject_kinds
    .map((value) => memory_subject_kind_schema.safeParse(value))
    .flatMap((result) => (result.success ? [result.data] : []));
}

/** Agent 长期记忆 Power。 */
export class MemoryPower extends Power {
  /** Power 稳定名称。 */
  readonly name = "memory";

  /** Power 用户可见标题。 */
  readonly title = "Memory";

  /** Power 用户可见说明。 */
  readonly description =
    "Provides provider-neutral long-term memory, recall, revision, and deletion.";

  /** 当前 City 生命周期内唯一的 Memory Provider。 */
  private provider_instance?: MemoryProvider;

  /** 宿主显式提供的平台数据根目录；用于定位 Agent 私有记忆。 */
  private readonly platform_root_path?: string;

  /** 显式启用的自动记忆参数。 */
  private readonly automatic_options: AutomaticMemoryOptions;

  /** City 生命周期内唯一入口判定与后台实例。 */
  private automatic_runtime?: AutomaticMemory;

  constructor(options: MemoryPowerOptions = {}) {
    super();
    this.automatic_options = options.automatic ?? {};
    const shared_root_path = options.shared_root_path?.trim();
    const platform_root_path = options.platform_root_path?.trim();
    if (shared_root_path && !path.isAbsolute(shared_root_path)) {
      throw new Error("MemoryPower shared_root_path must be an absolute path");
    }
    if (platform_root_path && !path.isAbsolute(platform_root_path)) {
      throw new Error("MemoryPower platform_root_path must be an absolute path");
    }
    if (shared_root_path) {
      this.provider_instance = create_memory_provider({
        shared_root_path,
        ...(platform_root_path ? { platform_root_path } : {}),
      });
    }
    this.platform_root_path = platform_root_path ? path.resolve(platform_root_path) : undefined;
  }

  /** 返回已经由 City 启动的唯一 Memory Provider。 */
  get provider(): MemoryProvider {
    if (!this.provider_instance) throw new Error("MemoryPower is not started by City");
    return this.provider_instance;
  }

  /** 构建不包含 Memory 数据的 Power 使用说明。 */
  async system(context: PowerContext): Promise<string> {
    void context;
    return build_memory_power_system_text(this.provider);
  }

  /** 使用现有 Power HookRegistry 接入 Session 三个通用检查点。 */
  readonly hooks: PowerHooks = {
    pipeline: {
      [SESSION_HOOK_POINTS.turn_context]: [async ({ context, value }) => {
        const input = value as unknown as SessionTurnContextHookValue;
        if (!this.automatic_runtime) return value;
        return await this.automatic_runtime.prepare(context, input) as unknown as PowerJsonValue;
      }],
    },
    effect: {
      [SESSION_HOOK_POINTS.turn_committed]: [async ({ context, value }) => {
        await this.capture_committed_turn(
          context,
          value as unknown as SessionTurnCommittedHookValue,
        );
      }],
    },
  };

  /** 仅登记完成状态，形成记忆交给 30 分钟 worker。 */
  private async capture_committed_turn(
    context: PowerContext,
    input: SessionTurnCommittedHookValue,
  ): Promise<void> {
    await this.automatic_runtime?.committed(context, input);
  }

  /** 启动当前 City 唯一的 Memory Provider，并注册界面管理 actions。 */
  async initialize(context: PowerLifecycleContext): Promise<void> {
    this.provider_instance ??= create_memory_provider({
      shared_root_path: context.storage.path,
      ...(this.platform_root_path ? { platform_root_path: this.platform_root_path } : {}),
    });
    await this.provider.initialize();
    register_memory_power_host_actions(context);
    const config = context.config.get();
    if (this.automatic_options.enabled ?? config.enabled === true) {
      this.automatic_runtime = new AutomaticMemory(context, this.provider, {
        ...this.automatic_options,
        decision_model_id: this.automatic_options.decision_model_id ?? (typeof config.decision_model_id === "string" ? config.decision_model_id : undefined),
        formation_model_id: this.automatic_options.formation_model_id ?? (typeof config.formation_model_id === "string" ? config.formation_model_id : undefined),
      });
      await this.automatic_runtime.initialize();
    }
    context.power.action({
      id: "memory.automatic_status",
      run: async () => this.automatic_runtime ? await this.automatic_runtime.status() : { enabled: false },
    });
  }

  /** 释放当前 City 唯一的 Memory Provider。 */
  async dispose(): Promise<void> {
    await this.automatic_runtime?.dispose();
    this.automatic_runtime = undefined;
    await this.provider_instance?.dispose();
    this.provider_instance = undefined;
  }

  /** 显式 actions 与自动入口使用同一可信用户解析器。 */
  private async resolve_action_access(context: PowerContext) {
    const access = resolve_memory_access(context);
    if (!this.automatic_options.resolve_user || !context.session) return access;
    const messages = await context.session.messages();
    const current = messages.filter((message) => message.role === "user" && (!context.turn || message.turn_id === context.turn.id)).at(-1);
    if (!current || typeof current.message_id !== "string") return access;
    const user_id = await this.automatic_options.resolve_user(context, current.message_id);
    return { ...access, ...(user_id ? { user_id } : {}) };
  }

  /** Memory 对 Agent 暴露的稳定 Action 集合。 */
  readonly actions: PowerActions = {
    status: create_action({
      description: "Inspect the active Memory Provider and its capabilities.",
      returns: "provider, state, capabilities, details, warnings",
      access: "read",
      input_schema: {
        zod: z.object({}).passthrough(),
        json_schema: { type: "object", additionalProperties: false, properties: {} },
      },
      examples: [{ title: "View Memory Provider status", payload: {} }],
      command: {
        description: "Inspect the active Memory Provider.",
        map_input: () => ({}),
      },
      execute: async ({ context }) => await status_memory_action(
        this.provider,
        await this.resolve_action_access(context),
      ),
    }),

    search: create_action({
      description: "Recall scoped long-term memories for a focused query.",
      returns: "memories(memory_id, type, content, scope, score, updated_at)",
      access: "read",
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
        return await search_memory_action(
          this.provider,
          await this.resolve_action_access(context),
          {
          query: read_string(body, "query"),
          max_results: read_optional_number(body, "max_results"),
          min_score: read_optional_number(body, "min_score"),
          include_evidence: read_optional_boolean(body, "include_evidence"),
          },
        );
      },
    }),

    read: create_action({
      description: "Read one exact memory by memory_id.",
      returns: "memory(memory_id, type, content, scope, created_at, updated_at)",
      access: "read",
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
      examples: [{
        title: "Read a memory",
        payload: { memory_id: "agent/cheng_xu_yuan/wiki/user-preferences" },
      }],
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
        return await read_memory_action(
          this.provider,
          await this.resolve_action_access(context),
          {
          memory_id: read_string(body, "memory_id"),
          from_line: read_optional_number(body, "from_line"),
          line_count: read_optional_number(body, "line_count"),
          },
        );
      },
    }),

    list: create_action({
      description: "List scoped long-term memories without a query.",
      returns: "provider, items(memory_id, memory_type, subject, title, snippet, observed_at, is_evidence), total, subject_counts",
      access: "read",
      input_schema: {
        zod: z.object({
          subject_kinds: z.array(memory_subject_kind_schema).optional(),
          memory_types: z.array(memory_type_schema).optional(),
          include_evidence: z.boolean().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        }),
        json_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            subject_kinds: {
              type: "array",
              items: { type: "string", enum: ["agent", "user", "workspace", "city"] },
              description: "Restrict results to these memory subjects.",
            },
            memory_types: {
              type: "array",
              items: {
                type: "string",
                enum: ["fact", "preference", "decision", "episode", "procedure", "document"],
              },
              description: "Restrict results to these memory types.",
            },
            include_evidence: {
              type: "boolean",
              description: "Include raw evidence records.",
            },
            limit: { type: "number", minimum: 1, maximum: 500 },
            offset: { type: "number", minimum: 0 },
          },
        },
      },
      examples: [{ title: "List stored memories", payload: { limit: 20 } }],
      command: {
        description: "List scoped long-term memories.",
        configure(command: Command) {
          command
            .option("--subject <kind>", "Restrict to agent or city.")
            .option("--memory-type <type>", "Restrict to one memory type.")
            .option("--include-evidence", "Include raw evidence records.")
            .option("--limit <number>", "Maximum result count.", parse_positive_integer)
            .option("--offset <number>", "Skip the first N results.", parse_non_negative_integer);
        },
        map_input({ opts }) {
          return {
            ...(typeof opts.subject === "string" ? { subject_kinds: [opts.subject] } : {}),
            ...(typeof opts.memoryType === "string" ? { memory_types: [opts.memoryType] } : {}),
            ...(opts.includeEvidence === true ? { include_evidence: true } : {}),
            ...(typeof opts.limit === "number" ? { limit: opts.limit } : {}),
            ...(typeof opts.offset === "number" ? { offset: opts.offset } : {}),
          };
        },
      },
      execute: async ({ context, input }) => {
        const body = read_body_object(input);
        return await list_memory_action(
          this.provider,
          await this.resolve_action_access(context),
          {
            subject_kinds: read_optional_subject_kind_list(body),
            memory_types: read_optional_memory_type_list(body),
            include_evidence: read_optional_boolean(body, "include_evidence"),
            limit: read_optional_number(body, "limit"),
            offset: read_optional_number(body, "offset"),
          },
        );
      },
    }),

    remember: create_action({
      description: "Store a durable fact, preference, decision, episode, procedure, or document.",
      returns: "memory_id, type, scope, status",
      access: "write",
      input_schema: {
        zod: z.object({
          content: z.string(),
          target: memory_write_target_schema,
          topic: z.string().optional(),
          memory_type: memory_type_schema.optional(),
          source: z.string().optional(),
        }),
        json_schema: {
          type: "object",
          additionalProperties: false,
          required: ["content", "target"],
          properties: {
            content: { type: "string", description: "Content to remember." },
            target: {
              type: "string",
              enum: ["current_workspace", "user", "agent"],
              description:
                "Write scope resolved from trusted identity. current_workspace uses an isolated Workspace Store; user requires a trusted platform identity.",
            },
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
          content: "This Workspace always uses pnpm.",
          target: "current_workspace",
          topic: "project-overview",
          memory_type: "decision",
        },
      }],
      command: {
        description: "Store a durable memory.",
        configure(command: Command) {
          command
            .requiredOption("--content <text>", "Content to remember.")
            .requiredOption("--target <target>", "current_workspace, user or agent.")
            .option("--topic <topic>", "Optional organization hint.")
            .option("--memory-type <type>", "Memory type.")
            .option("--source <source>", "Optional evidence label.");
        },
        map_input({ opts }) {
          return {
            content: String(opts.content || ""),
            target: String(opts.target || ""),
            ...(typeof opts.topic === "string" ? { topic: opts.topic } : {}),
            ...(typeof opts.memoryType === "string" ? { memory_type: opts.memoryType } : {}),
            ...(typeof opts.source === "string" ? { source: opts.source } : {}),
          };
        },
      },
      execute: async ({ context, input }) => {
        const body = read_body_object(input);
        return await remember_memory_action(
          this.provider,
          await this.resolve_action_access(context),
          {
          content: read_string(body, "content"),
          target: read_memory_write_target(body),
          topic: read_optional_string(body, "topic"),
          memory_type: read_optional_memory_type(body),
          source: read_optional_string(body, "source"),
          },
        );
      },
    }),

    digest: create_action({
      description: "Digest a canonical Session transcript into long-term memory.",
      returns: "digested, memory_ids, warnings",
      access: "write",
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
        return await digest_memory_action(
          context,
          this.provider,
          await this.resolve_action_access(context),
          {
          session_id: read_string(body, "session_id"),
          max_messages: read_optional_number(body, "max_messages"),
          },
        );
      },
    }),

    revise: create_action({
      description: "Revise one memory using new evidence.",
      returns: "memory_id, status, version",
      access: "write",
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
          memory_id: "agent/cheng_xu_yuan/wiki/user-preferences",
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
        return await revise_memory_action(
          this.provider,
          await this.resolve_action_access(context),
          {
          memory_id: read_string(body, "memory_id"),
          instruction: read_string(body, "instruction"),
          evidence: read_optional_string(body, "evidence"),
          },
        );
      },
    }),

    forget: create_action({
      description: "Delete or invalidate one memory by memory_id.",
      returns: "memory_id, status",
      access: "write",
      input_schema: {
        zod: z.object({ memory_id: z.string() }),
        json_schema: {
          type: "object",
          additionalProperties: false,
          required: ["memory_id"],
          properties: { memory_id: { type: "string" } },
        },
      },
      examples: [{
        title: "Forget a memory",
        payload: { memory_id: "agent/id_YWdlbnQ/wiki/obsolete" },
      }],
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
        return await forget_memory_action(
          this.provider,
          await this.resolve_action_access(context),
          {
          memory_id: read_string(body, "memory_id"),
          },
        );
      },
    }),
  };
}

/** 创建内建 Memory Provider，并把 Agent 私有根与共享根路由到不同物理目录。 */
function create_memory_provider(input: {
  /** City 为当前 MemoryPower 唯一实例分配的共享绝对目录。 */
  shared_root_path: string;

  /** 平台数据根目录；用于推导 `agents/<agent_id>/memory`。 */
  platform_root_path?: string;
}): MemoryProvider {
  const platform_root_path = String(input.platform_root_path || "").trim();
  if (!platform_root_path || !path.isAbsolute(platform_root_path)) {
    throw new Error(
      "MemoryPower requires an absolute platform_root_path to locate Agent private memory",
    );
  }
  return new BuiltinMemoryProvider({
    city_memory_available: true,
    storage: new MemoryStorageRouter({
      shared_storage: new FileMemoryStorageAdapter({ root_path: input.shared_root_path }),
      create_agent_storage: (agent_id) => new FileMemoryStorageAdapter({
        root_path: get_default_file_memory_root_path({
          platform_root_path,
          agent_id,
        }),
      }),
    }),
  });
}
