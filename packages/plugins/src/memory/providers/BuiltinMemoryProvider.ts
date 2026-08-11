/**
 * BuiltinMemoryProvider：Downcity 默认的本地长期记忆实现。
 *
 * 关键点（中文）
 * - Provider 负责 Memory 领域语义，底层 Storage Adapter 只负责文本持久化。
 * - memory_id、citation 与 scope 均为逻辑协议，不暴露 Adapter 的物理位置。
 * - 当前召回使用确定性文本扫描；以后可在 Provider 内替换索引而不改变 Plugin API。
 */

import { randomUUID } from "node:crypto";
import type {
  BuiltinMemoryDigestHandlerOutput,
  BuiltinMemoryProjectionDraft,
  BuiltinMemoryProviderOptions,
  BuiltinMemoryReviseHandlerOutput,
} from "@/memory/types/BuiltinMemoryProvider.js";
import type {
  MemoryDigestInput,
  MemoryDigestResult,
  MemoryForgetInput,
  MemoryForgetResult,
  MemoryProvider,
  MemoryProviderCapabilities,
  MemoryProviderInitializeInput,
  MemoryReadInput,
  MemoryReadResult,
  MemoryRecallInput,
  MemoryRecallItem,
  MemoryRecallResult,
  MemoryRecord,
  MemoryRememberInput,
  MemoryRememberResult,
  MemoryReviseInput,
  MemoryReviseResult,
  MemoryScope,
  MemorySourceReference,
  MemoryStatusResult,
  MemorySystemContextInput,
  MemorySystemContextItem,
  MemorySystemContextResult,
  MemoryType,
} from "@/memory/types/Memory.js";
import type {
  MemoryStorageAdapter,
  MemoryStorageEntry,
} from "@/memory/types/MemoryStorage.js";

const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_MIN_SCORE = 0.35;
const DEFAULT_MAX_CONTEXT_CHARS = 4_000;
const SNIPPET_MAX_CHARS = 700;
const CHUNK_MAX_CHARS = 1_600;
const CHUNK_OVERLAP_CHARS = 240;
const INDEX_MEMORY_ID = "wiki/index";

/** Provider 内部解析出的 Markdown 元数据。 */
interface BuiltinMemoryMetadata {
  /** 可选标题。 */
  title?: string;

  /** 当前记忆类型。 */
  memory_type: MemoryType;

  /** 当前内容形成时间。 */
  observed_at: string;

  /** 当前记忆引用的证据集合。 */
  source_refs: MemorySourceReference[];
}

/** Provider 内部使用的有界文本片段。 */
interface BuiltinMemoryChunk {
  /** 当前片段所属记录。 */
  memory: MemoryRecord;

  /** 当前片段起始行号。 */
  start_line: number;

  /** 当前片段结束行号。 */
  end_line: number;

  /** 当前片段文本。 */
  text: string;
}

/** 限制数值到给定闭区间。 */
function clamp_number(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

/** 生成用于文件实现内部组织的稳定 slug。 */
function slugify(value: string): string {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return text || "inbox";
}

/** 规范化 Provider 公开 memory_id。 */
function normalize_memory_id(input: string): string {
  const memory_id = String(input || "")
    .replace(/\\/g, "/")
    .replace(/^memory:\/\/builtin\//, "")
    .replace(/^\/+/, "")
    .replace(/\.md$/i, "")
    .trim();
  if (!memory_id) throw new Error("memory_id is required");
  const segments = memory_id.split("/");
  if (segments.some((segment) => !/^[a-z0-9][a-z0-9_-]*$/u.test(segment))) {
    throw new Error(`Invalid memory_id: ${input}`);
  }
  if (segments[0] !== "wiki" && segments[0] !== "evidence") {
    throw new Error(`Unsupported Builtin memory_id: ${input}`);
  }
  return segments.join("/");
}

/** 把公开 memory_id 映射为 Storage Adapter 内部 key。 */
function memory_id_to_key(memory_id: string): string {
  return `${normalize_memory_id(memory_id)}.md`;
}

/** 把 Storage Adapter 内部 key 映射为公开 memory_id。 */
function key_to_memory_id(key: string): string {
  return normalize_memory_id(String(key || "").replace(/\.md$/i, ""));
}

/** 创建 Provider 逻辑 citation。 */
function create_citation(
  memory_id: string,
  start_line?: number,
  end_line?: number,
): string {
  const base = `memory://builtin/${normalize_memory_id(memory_id)}`;
  if (!start_line) return base;
  return end_line && end_line !== start_line
    ? `${base}#L${start_line}-L${end_line}`
    : `${base}#L${start_line}`;
}

/** 去除 Markdown frontmatter，并保留内容行语义。 */
function strip_frontmatter(content: string): string {
  const normalized = String(content || "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized.trim();
  const end_index = normalized.indexOf("\n---\n", 4);
  return end_index < 0 ? normalized.trim() : normalized.slice(end_index + 5).trim();
}

/** 从简化 frontmatter 中读取单个 JSON 字段。 */
function read_frontmatter_json(content: string, key: string): unknown {
  const normalized = String(content || "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return undefined;
  const end_index = normalized.indexOf("\n---\n", 4);
  if (end_index < 0) return undefined;
  const prefix = `${key}:`;
  const line = normalized.slice(4, end_index)
    .split("\n")
    .find((item) => item.startsWith(prefix));
  if (!line) return undefined;
  const raw_value = line.slice(prefix.length).trim();
  try {
    return JSON.parse(raw_value);
  } catch {
    return raw_value;
  }
}

/** 从 Provider Markdown 读取稳定元数据。 */
function parse_metadata(content: string, fallback_type: MemoryType): BuiltinMemoryMetadata {
  const raw_type = read_frontmatter_json(content, "memory_type");
  const allowed_types = new Set<MemoryType>([
    "fact",
    "preference",
    "decision",
    "episode",
    "procedure",
    "document",
  ]);
  const memory_type = typeof raw_type === "string" && allowed_types.has(raw_type as MemoryType)
    ? raw_type as MemoryType
    : fallback_type;
  const raw_observed_at = read_frontmatter_json(content, "observed_at");
  const raw_source_refs = read_frontmatter_json(content, "source_refs");
  const source_refs = Array.isArray(raw_source_refs)
    ? raw_source_refs.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const record = value as Record<string, unknown>;
        const source_id = String(record.source_id || "").trim();
        const source_type = String(record.source_type || "").trim();
        if (!source_id || !source_type) return [];
        const label = String(record.label || "").trim();
        return [{
          source_id,
          source_type,
          ...(label ? { label } : {}),
        } satisfies MemorySourceReference];
      })
    : [];
  const title = read_frontmatter_json(content, "title");
  return {
    ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}),
    memory_type,
    observed_at: typeof raw_observed_at === "string" && raw_observed_at.trim()
      ? raw_observed_at.trim()
      : new Date(0).toISOString(),
    source_refs,
  };
}

/** 生成 Builtin Provider 使用的 Markdown 记录。 */
function create_markdown_record(input: {
  title: string;
  content: string;
  memory_type: MemoryType;
  source_refs?: MemorySourceReference[];
  observed_at?: string;
  tags?: string[];
}): string {
  const tags = input.tags?.map((tag) => String(tag || "").trim()).filter(Boolean) ?? [];
  return [
    "---",
    `title: ${JSON.stringify(input.title)}`,
    `memory_type: ${JSON.stringify(input.memory_type)}`,
    `observed_at: ${JSON.stringify(input.observed_at || new Date().toISOString())}`,
    `source_refs: ${JSON.stringify(input.source_refs || [])}`,
    `tags: ${JSON.stringify(tags)}`,
    "---",
    "",
    String(input.content || "").trim(),
    "",
  ].join("\n");
}

/** 把 Storage 条目转换为领域记录。 */
function storage_entry_to_record(
  entry: MemoryStorageEntry,
  scope: MemoryScope,
): MemoryRecord {
  const memory_id = key_to_memory_id(entry.key);
  const is_evidence = memory_id.startsWith("evidence/");
  const metadata = parse_metadata(entry.content, is_evidence ? "episode" : "document");
  return {
    memory_id,
    memory_type: metadata.memory_type,
    scope: { agent_id: scope.agent_id },
    content: strip_frontmatter(entry.content),
    observed_at: metadata.observed_at,
    source_refs: metadata.source_refs,
    citation: create_citation(memory_id),
    ...(metadata.title ? { metadata: { title: metadata.title } } : {}),
  };
}

/** 把查询文本拆成有界 token。 */
function tokenize_query(raw: string): string[] {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 16);
}

/** 计算片段的确定性覆盖率和密度分数。 */
function score_chunk(text: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const normalized = String(text || "").toLowerCase();
  let matched_tokens = 0;
  let total_hits = 0;
  for (const token of tokens) {
    let hits = 0;
    let start_index = 0;
    while (start_index < normalized.length) {
      const found_index = normalized.indexOf(token, start_index);
      if (found_index < 0) break;
      hits += 1;
      start_index = found_index + token.length;
    }
    if (hits > 0) {
      matched_tokens += 1;
      total_hits += Math.min(hits, 4);
    }
  }
  if (matched_tokens === 0) return 0;
  const coverage = matched_tokens / tokens.length;
  const density = Math.min(total_hits, tokens.length * 3) / (tokens.length * 3);
  return Number((coverage * 0.75 + density * 0.25).toFixed(4));
}

/** 把完整记录切分成带行号的有界片段。 */
function chunk_memory(memory: MemoryRecord): BuiltinMemoryChunk[] {
  const lines = memory.content.replace(/\r\n/g, "\n").split("\n");
  const chunks: BuiltinMemoryChunk[] = [];
  let bucket: Array<{ line: string; line_number: number }> = [];
  let character_count = 0;

  const flush = (): void => {
    const text = bucket.map((item) => item.line).join("\n").trim();
    if (!text || bucket.length === 0) return;
    chunks.push({
      memory,
      start_line: bucket[0]?.line_number ?? 1,
      end_line: bucket[bucket.length - 1]?.line_number ?? 1,
      text,
    });
  };

  const carry_overlap = (): void => {
    let size = 0;
    const next: Array<{ line: string; line_number: number }> = [];
    for (let index = bucket.length - 1; index >= 0; index -= 1) {
      const row = bucket[index];
      if (!row) continue;
      size += row.line.length + 1;
      next.unshift(row);
      if (size >= CHUNK_OVERLAP_CHARS) break;
    }
    bucket = next;
    character_count = size;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    const row_size = line.length + 1;
    if (bucket.length > 0 && character_count + row_size > CHUNK_MAX_CHARS) {
      flush();
      carry_overlap();
    }
    bucket.push({ line, line_number: index + 1 });
    character_count += row_size;
  }
  flush();
  return chunks;
}

/** 读取 handler 的 digest 输出。 */
function normalize_digest_output(
  output: BuiltinMemoryDigestHandlerOutput | string,
): BuiltinMemoryDigestHandlerOutput {
  return typeof output === "string"
    ? {
        projections: [{
          memory_id: "wiki/session-digests",
          title: "Session Digests",
          content: output,
          tags: ["memory", "digest"],
        }],
      }
    : output;
}

/** 读取 handler 的 revise 输出。 */
function normalize_revise_output(
  output: BuiltinMemoryReviseHandlerOutput | string,
  fallback_memory_id: string,
): BuiltinMemoryReviseHandlerOutput {
  return typeof output === "string"
    ? { memory_id: fallback_memory_id, content: output }
    : output;
}

/** Downcity 默认的 provider-neutral Memory 实现。 */
export class BuiltinMemoryProvider implements MemoryProvider {
  /** 当前 Provider 稳定名称。 */
  readonly name = "builtin";

  /** 当前 Provider 支持的完整能力。 */
  readonly capabilities: MemoryProviderCapabilities = Object.freeze({
    remember: true,
    recall: true,
    read: true,
    revise: true,
    forget: true,
    digest: true,
    system_context: true,
  });

  /** 当前 Provider 已创建的唯一低层存储 Adapter。 */
  private storage?: MemoryStorageAdapter;

  /** 当前 Provider 可选使用的延迟 Storage Adapter 工厂。 */
  private readonly create_storage: BuiltinMemoryProviderOptions["create_storage"];

  /** 当前 Provider 可选使用的 Session 提炼处理器。 */
  private readonly digest_handler: BuiltinMemoryProviderOptions["digest"];

  /** 当前 Provider 可选使用的内容修订处理器。 */
  private readonly revise_handler: BuiltinMemoryProviderOptions["revise"];

  /** 当前 Provider 已初始化的 Agent 运行身份。 */
  private runtime?: MemoryProviderInitializeInput;

  constructor(options: BuiltinMemoryProviderOptions) {
    const has_storage = Boolean(options?.storage);
    const has_factory = typeof options?.create_storage === "function";
    if (has_storage === has_factory) {
      throw new Error("BuiltinMemoryProvider requires exactly one storage or create_storage");
    }
    this.storage = options.storage;
    this.create_storage = options.create_storage;
    this.digest_handler = options.digest;
    this.revise_handler = options.revise;
  }

  /** 初始化 Adapter 和默认索引投影。 */
  async initialize(input: MemoryProviderInitializeInput): Promise<void> {
    const agent_id = String(input.agent_id || "").trim();
    if (!agent_id) throw new Error("BuiltinMemoryProvider requires agent_id");
    if (this.runtime && this.runtime.agent_id !== agent_id) {
      throw new Error("BuiltinMemoryProvider is already bound to another Agent");
    }
    const created_storage = !this.storage;
    const storage = this.storage ?? await this.create_storage?.({ agent_id });
    if (!storage) throw new Error("BuiltinMemoryProvider storage factory returned no Adapter");
    this.storage = storage;
    try {
      await storage.initialize();
      if (!await storage.has(memory_id_to_key(INDEX_MEMORY_ID))) {
        await this.write_projection({
          memory_id: INDEX_MEMORY_ID,
          title: "Memory Index",
          content: "Long-term memories are available through MemoryPlugin recall and read actions.",
          tags: ["memory", "index"],
        }, [], "document");
      }
    } catch (error) {
      if (created_storage) {
        await storage.dispose().catch(() => undefined);
        this.storage = undefined;
      }
      throw error;
    }
    this.runtime = { agent_id };
  }

  /** 返回 Provider 状态与可重建统计。 */
  async status(): Promise<MemoryStatusResult> {
    this.require_runtime();
    const [wiki_entries, evidence_entries] = await Promise.all([
      this.active_storage.list("wiki"),
      this.active_storage.list("evidence"),
    ]);
    const scope = this.create_runtime_scope();
    const chunk_count = [...wiki_entries, ...evidence_entries]
      .map((entry) => storage_entry_to_record(entry, scope))
      .reduce((count, memory) => count + chunk_memory(memory).length, 0);
    return {
      provider: this.name,
      state: "ready",
      capabilities: this.capabilities,
      details: {
        storage_adapter: this.active_storage.name,
        memories: wiki_entries.length,
        evidence: evidence_entries.length,
        chunks: chunk_count,
      },
    };
  }

  /** 使用确定性扫描召回记忆，底层存储形态对调用方不可见。 */
  async recall(input: MemoryRecallInput): Promise<MemoryRecallResult> {
    this.assert_scope(input.scope);
    const query = String(input.query || "").trim();
    if (!query) return { provider: this.name, items: [] };
    const tokens = tokenize_query(query);
    if (tokens.length === 0) return { provider: this.name, items: [] };
    const entries = [
      ...await this.active_storage.list("wiki"),
      ...(input.include_evidence ? await this.active_storage.list("evidence") : []),
    ];
    const max_results = Math.floor(clamp_number(
      Number(input.max_results ?? DEFAULT_MAX_RESULTS),
      1,
      20,
    ));
    const min_score = clamp_number(
      Number(input.min_score ?? DEFAULT_MIN_SCORE),
      0,
      1,
    );
    const items = entries
      .map((entry) => storage_entry_to_record(entry, this.create_runtime_scope()))
      .flatMap((memory) => chunk_memory(memory))
      .map((chunk): MemoryRecallItem => {
        const score = score_chunk(chunk.text, tokens);
        const citation = create_citation(
          chunk.memory.memory_id,
          chunk.start_line,
          chunk.end_line,
        );
        return {
          memory: { ...chunk.memory, citation },
          score,
          snippet: chunk.text.length <= SNIPPET_MAX_CHARS
            ? chunk.text
            : chunk.text.slice(0, SNIPPET_MAX_CHARS),
        };
      })
      .filter((item) => item.score >= min_score)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.memory.memory_id.localeCompare(right.memory.memory_id);
      })
      .slice(0, max_results);
    return { provider: this.name, items };
  }

  /** 按 memory_id 精确读取并应用可选行预算。 */
  async read(input: MemoryReadInput): Promise<MemoryReadResult> {
    this.assert_scope(input.scope);
    const memory_id = normalize_memory_id(input.memory_id);
    const content = await this.active_storage.read(memory_id_to_key(memory_id));
    if (content === null) return { memory_id, memory: null };
    const base = storage_entry_to_record({
      key: memory_id_to_key(memory_id),
      content,
    }, this.create_runtime_scope());
    const from_line = input.from_line
      ? Math.max(1, Math.floor(input.from_line))
      : undefined;
    const line_count = input.line_count
      ? Math.max(1, Math.floor(input.line_count))
      : undefined;
    if (!from_line && !line_count) return { memory_id, memory: base };
    const lines = base.content.split("\n");
    const start = from_line ?? 1;
    const count = line_count ?? lines.length;
    const end = Math.min(lines.length, start + count - 1);
    return {
      memory_id,
      memory: {
        ...base,
        content: lines.slice(start - 1, end).join("\n"),
        citation: create_citation(memory_id, start, end),
      },
    };
  }

  /** 保存原始证据并形成或更新长期记忆。 */
  async remember(input: MemoryRememberInput): Promise<MemoryRememberResult> {
    this.assert_scope(input.scope);
    const content = String(input.content || "").trim();
    if (!content) throw new Error("Memory remember requires content");
    const evidence_id = `evidence/manual/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
    await this.write_evidence(evidence_id, content, input.scope, input.source || "manual");
    const memory_id = `wiki/${slugify(input.topic || "inbox")}`;
    const existing = await this.active_storage.read(memory_id_to_key(memory_id));
    const source_refs: MemorySourceReference[] = [{
      source_id: evidence_id,
      source_type: "manual",
      ...(input.source ? { label: input.source } : {}),
    }];

    if (this.revise_handler) {
      const revised = normalize_revise_output(await this.revise_handler({
        memory_id,
        current_content: existing ? strip_frontmatter(existing) : "",
        instruction: "Integrate the new evidence, deduplicate it, and keep the memory concise.",
        evidence: content,
      }), memory_id);
      const target_memory_id = normalize_memory_id(revised.memory_id || memory_id);
      await this.write_projection({
        memory_id: target_memory_id,
        title: input.topic || "Memory Inbox",
        content: revised.content,
      }, source_refs, input.memory_type || "fact");
      return {
        memory_id: target_memory_id,
        evidence_id,
        mode: existing ? "updated" : "created",
        ...(revised.summary ? { summary: revised.summary } : {}),
      };
    }

    await this.append_projection({
      memory_id,
      title: input.topic || "Memory Inbox",
      content,
      source_refs,
      memory_type: input.memory_type || "fact",
    });
    return {
      memory_id,
      evidence_id,
      mode: existing ? "updated" : "created",
    };
  }

  /** 保存 Session 证据，并通过可选 handler 形成长期投影。 */
  async digest(input: MemoryDigestInput): Promise<MemoryDigestResult> {
    this.assert_scope(input.scope);
    const session_id = String(input.session_id || "").trim();
    if (!session_id) throw new Error("Memory digest requires session_id");
    const transcript = String(input.transcript || "").trim();
    if (!transcript) throw new Error("Memory digest requires transcript content");
    const evidence_id = `evidence/session/${slugify(session_id)}/${randomUUID()}`;
    await this.write_evidence(evidence_id, transcript, input.scope, `session:${session_id}`);
    const source_refs: MemorySourceReference[] = [{
      source_id: evidence_id,
      source_type: "session",
      label: session_id,
    }];

    if (this.digest_handler) {
      const index_content = await this.active_storage.read(memory_id_to_key(INDEX_MEMORY_ID));
      const output = normalize_digest_output(await this.digest_handler({
        source_text: transcript,
        source_id: evidence_id,
        session_id,
        current_index: index_content ? strip_frontmatter(index_content) : "",
      }));
      const memory_ids: string[] = [];
      for (const projection of output.projections) {
        const memory_id = await this.write_projection(
          projection,
          source_refs,
          "episode",
        );
        memory_ids.push(memory_id);
      }
      return {
        memory_ids,
        evidence_id,
        message_count: input.message_count,
        mode: "projected",
        ...(output.summary ? { summary: output.summary } : {}),
      };
    }

    const memory_id = "wiki/session-digests";
    await this.append_projection({
      memory_id,
      title: "Session Digests",
      content: transcript,
      source_refs,
      memory_type: "episode",
    });
    return {
      memory_ids: [memory_id],
      evidence_id,
      message_count: input.message_count,
      mode: "archived",
    };
  }

  /** 修订既有记忆，并在无 handler 时使用可审计追加语义。 */
  async revise(input: MemoryReviseInput): Promise<MemoryReviseResult> {
    this.assert_scope(input.scope);
    const memory_id = normalize_memory_id(input.memory_id);
    const instruction = String(input.instruction || "").trim();
    if (!instruction) throw new Error("Memory revise requires instruction");
    const evidence = String(input.evidence || "").trim();
    const existing = await this.active_storage.read(memory_id_to_key(memory_id));
    if (existing === null) throw new Error(`Memory not found: ${memory_id}`);
    const metadata = parse_metadata(existing, "document");
    const evidence_id = evidence
      ? `evidence/manual/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`
      : undefined;
    const source_refs = [...metadata.source_refs];
    if (evidence_id) {
      await this.write_evidence(
        evidence_id,
        evidence,
        input.scope,
        `revision:${memory_id}`,
      );
      source_refs.push({
        source_id: evidence_id,
        source_type: "manual",
        label: `revision:${memory_id}`,
      });
    }
    if (this.revise_handler) {
      const revised = normalize_revise_output(await this.revise_handler({
        memory_id,
        current_content: strip_frontmatter(existing),
        instruction,
        evidence,
      }), memory_id);
      const target_memory_id = normalize_memory_id(revised.memory_id || memory_id);
      await this.write_projection({
        memory_id: target_memory_id,
        title: String(metadata.title || target_memory_id),
        content: revised.content,
      }, source_refs, metadata.memory_type);
      return {
        memory_id: target_memory_id,
        ...(evidence_id ? { evidence_id } : {}),
        mode: "revised",
        ...(revised.summary ? { summary: revised.summary } : {}),
      };
    }
    const addition = [
      `## ${new Date().toISOString()}`,
      "",
      `Instruction: ${instruction}`,
      "",
      evidence || "(no evidence)",
      "",
    ].join("\n");
    await this.active_storage.write(memory_id_to_key(memory_id), create_markdown_record({
      title: metadata.title || memory_id,
      content: `${strip_frontmatter(existing)}\n\n${addition}`,
      memory_type: metadata.memory_type,
      source_refs,
      tags: ["memory"],
      observed_at: metadata.observed_at,
    }));
    return {
      memory_id,
      ...(evidence_id ? { evidence_id } : {}),
      mode: "appended",
    };
  }

  /** 删除当前 Provider 中的指定记忆。 */
  async forget(input: MemoryForgetInput): Promise<MemoryForgetResult> {
    this.assert_scope(input.scope);
    const memory_id = normalize_memory_id(input.memory_id);
    const key = memory_id_to_key(memory_id);
    const forgotten = await this.active_storage.has(key);
    await this.active_storage.delete(key);
    return { memory_id, forgotten };
  }

  /** 从稳定候选投影中生成有界 system context。 */
  async system_context(
    input: MemorySystemContextInput,
  ): Promise<MemorySystemContextResult> {
    this.assert_scope(input.scope);
    const max_items = Math.max(0, Math.floor(input.max_items));
    const max_chars = Math.max(0, Math.floor(input.max_chars || DEFAULT_MAX_CONTEXT_CHARS));
    if (max_items === 0 || max_chars === 0) return { items: [] };
    const candidates = [
      "wiki/user-preferences",
      "wiki/project-overview",
      "wiki/rules",
      INDEX_MEMORY_ID,
    ];
    const items: MemorySystemContextItem[] = [];
    let remaining_chars = max_chars;
    for (const memory_id of candidates) {
      const content = await this.active_storage.read(memory_id_to_key(memory_id));
      if (!content) continue;
      const stable_lines = strip_frontmatter(content)
        .split("\n")
        .map((line) => line.trim().replace(/^[-*]\s+/, ""))
        .filter((line) => line && !line.startsWith("#"))
        .slice(0, 3)
        .join("\n");
      if (!stable_lines) continue;
      const bounded_content = stable_lines.slice(0, remaining_chars);
      if (!bounded_content) break;
      items.push({
        memory_id,
        content: bounded_content,
        citation: create_citation(memory_id),
      });
      remaining_chars -= bounded_content.length;
      if (items.length >= max_items || remaining_chars <= 0) break;
    }
    return { items };
  }

  /** 释放底层 Adapter 并关闭当前绑定。 */
  async dispose(): Promise<void> {
    try {
      await this.storage?.dispose();
    } finally {
      if (this.create_storage) this.storage = undefined;
      this.runtime = undefined;
    }
  }

  /** 返回当前已创建的唯一 Storage Adapter。 */
  private get active_storage(): MemoryStorageAdapter {
    if (!this.storage) throw new Error("BuiltinMemoryProvider storage is not initialized");
    return this.storage;
  }

  /** 创建当前 Runtime 的最小 Agent scope。 */
  private create_runtime_scope(): MemoryScope {
    const runtime = this.require_runtime();
    return { agent_id: runtime.agent_id };
  }

  /** 校验调用作用域属于当前已初始化 Agent。 */
  private assert_scope(scope: MemoryScope): void {
    const runtime = this.require_runtime();
    if (String(scope.agent_id || "").trim() !== runtime.agent_id) {
      throw new Error("Memory scope agent_id does not match initialized Provider");
    }
  }

  /** 返回已初始化 Runtime，否则拒绝隐式回退。 */
  private require_runtime(): MemoryProviderInitializeInput {
    if (!this.runtime) throw new Error("BuiltinMemoryProvider is not initialized");
    return this.runtime;
  }

  /** 保存一条 Provider 内部证据记录。 */
  private async write_evidence(
    evidence_id: string,
    content: string,
    scope: MemoryScope,
    label: string,
  ): Promise<void> {
    const normalized_id = normalize_memory_id(evidence_id);
    await this.active_storage.write(memory_id_to_key(normalized_id), create_markdown_record({
      title: label,
      content,
      memory_type: "episode",
      source_refs: [{
        source_id: normalized_id,
        source_type: label.startsWith("session:") ? "session" : "manual",
        label,
      }],
      tags: ["memory", "evidence", scope.agent_id],
    }));
  }

  /** 创建或替换一条长期记忆投影。 */
  private async write_projection(
    projection: BuiltinMemoryProjectionDraft,
    source_refs: MemorySourceReference[],
    memory_type: MemoryType,
  ): Promise<string> {
    const memory_id = normalize_memory_id(
      projection.memory_id || `wiki/${slugify(projection.title || "inbox")}`,
    );
    if (!memory_id.startsWith("wiki/")) {
      throw new Error(`Builtin projection must use wiki memory_id: ${memory_id}`);
    }
    const content = String(projection.content || "").trim();
    if (!content) throw new Error(`Builtin projection requires content: ${memory_id}`);
    const key = memory_id_to_key(memory_id);
    const existing = await this.active_storage.read(key);
    const existing_source_refs = existing
      ? parse_metadata(existing, memory_type).source_refs
      : [];
    const merged_source_refs = [...existing_source_refs];
    for (const source_ref of source_refs) {
      if (merged_source_refs.some((item) => item.source_id === source_ref.source_id)) continue;
      merged_source_refs.push(source_ref);
    }
    await this.active_storage.write(key, create_markdown_record({
      title: String(projection.title || memory_id).trim(),
      content,
      memory_type,
      source_refs: merged_source_refs,
      tags: projection.tags || ["memory"],
    }));
    return memory_id;
  }

  /** 以确定性方式向一条长期记忆投影追加内容。 */
  private async append_projection(input: {
    memory_id: string;
    title: string;
    content: string;
    source_refs: MemorySourceReference[];
    memory_type: MemoryType;
  }): Promise<void> {
    const memory_id = normalize_memory_id(input.memory_id);
    const key = memory_id_to_key(memory_id);
    const existing = await this.active_storage.read(key);
    if (existing === null) {
      await this.write_projection({
        memory_id,
        title: input.title,
        content: input.content,
      }, input.source_refs, input.memory_type);
      return;
    }
    const metadata = parse_metadata(existing, input.memory_type);
    const combined_source_refs = [...metadata.source_refs];
    for (const source_ref of input.source_refs) {
      if (combined_source_refs.some((item) => item.source_id === source_ref.source_id)) continue;
      combined_source_refs.push(source_ref);
    }
    const addition = [
      `## ${new Date().toISOString()}`,
      "",
      String(input.content || "").trim(),
      "",
      `Sources: ${input.source_refs.map((source) => source.source_id).join(", ")}`,
      "",
    ].join("\n");
    await this.active_storage.write(key, create_markdown_record({
      title: metadata.title || input.title,
      content: `${strip_frontmatter(existing)}\n\n${addition}`,
      memory_type: metadata.memory_type,
      source_refs: combined_source_refs,
      tags: ["memory"],
      observed_at: metadata.observed_at === new Date(0).toISOString()
        ? new Date().toISOString()
        : metadata.observed_at,
    }));
  }
}
