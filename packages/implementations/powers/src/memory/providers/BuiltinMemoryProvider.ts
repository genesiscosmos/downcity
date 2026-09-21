/**
 * BuiltinMemoryProvider：Downcity 默认的本地长期记忆实现。
 *
 * 关键点（中文）
 * - Provider 负责 Memory 领域语义，底层 Storage Adapter 只负责文本持久化。
 * - memory_id、citation 与 access 均为逻辑协议，不暴露 Adapter 的物理位置。
 * - 当前召回使用确定性文本扫描；以后可在 Provider 内替换索引而不改变 Power API。
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  BuiltinMemoryProjectionDraft,
  BuiltinMemoryProviderOptions,
} from "@/memory/types/BuiltinMemoryProvider.js";
import type {
  MemoryDigestInput,
  MemoryDigestResult,
  MemoryForgetInput,
  MemoryForgetResult,
  MemoryListInput,
  MemoryListResult,
  MemoryProvider,
  MemoryProviderCapabilities,
  MemoryReadInput,
  MemoryReadResult,
  MemoryRecallInput,
  MemoryRecallItem,
  MemoryRecallResult,
  MemoryRememberInput,
  MemoryRememberResult,
  MemoryReviseInput,
  MemoryReviseResult,
  MemorySourceReference,
  MemoryStatusResult,
  MemorySystemContextInput,
  MemorySystemContextItem,
  MemorySystemContextResult,
  MemoryType,
  MemoryCaptureTurnInput,
  MemoryCaptureTurnResult,
} from "@/memory/types/Memory.js";
import type {
  MemoryAccessContext,
  MemoryWriteTarget,
} from "@/memory/types/MemoryAccess.js";
import type {
  MemoryStorageAdapter,
} from "@/memory/types/MemoryStorage.js";
import {
  resolve_readable_memory_address,
  resolve_readable_memory_addresses,
  resolve_writable_memory_address,
  type MemorySubjectAddress,
} from "@/memory/runtime/MemoryAddress.js";
import {
  chunk_memory_record,
  score_memory_chunk,
  tokenize_memory_query,
} from "@/memory/runtime/MemoryRecall.js";
import {
  clamp_number,
  count_memory_subjects,
  create_citation,
  create_markdown_record,
  create_subject_memory_id,
  memory_id_to_key,
  normalize_digest_output,
  normalize_list_limit,
  normalize_list_offset,
  normalize_memory_id,
  normalize_memory_types,
  normalize_revise_output,
  normalize_subject_kinds,
  parse_metadata,
  slugify,
  storage_entry_to_record,
  strip_frontmatter,
  to_memory_list_item,
} from "@/memory/runtime/BuiltinMemoryDocument.js";

const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_MIN_SCORE = 0.35;
const DEFAULT_MAX_CONTEXT_CHARS = 4_000;
const SNIPPET_MAX_CHARS = 700;
const INDEX_RELATIVE_MEMORY_ID = "wiki/index";

/** Downcity 默认的 provider-neutral Memory 实现。 */
export class BuiltinMemoryProvider implements MemoryProvider {
  /** 当前 Provider 稳定名称。 */
  readonly name = "builtin";

  /** 当前 Provider 支持的完整能力。 */
  readonly capabilities: MemoryProviderCapabilities = Object.freeze({
    remember: true,
    recall: true,
    read: true,
    list: true,
    revise: true,
    forget: true,
    digest: true,
    system_context: true,
    capture_turn: true,
  });

  /** 当前 Provider 已创建的唯一低层存储 Adapter。 */
  private storage?: MemoryStorageAdapter;

  /** 当前 Provider 可选使用的延迟 Storage Adapter 工厂。 */
  private readonly create_storage: BuiltinMemoryProviderOptions["create_storage"];

  /** 当前 Provider 可选使用的 Session 提炼处理器。 */
  private readonly digest_handler: BuiltinMemoryProviderOptions["digest"];

  /** 当前 Provider 可选使用的内容修订处理器。 */
  private readonly revise_handler: BuiltinMemoryProviderOptions["revise"];

  /** 当前统一 Adapter 是否包含 City 共享 Store。 */
  private readonly city_memory_available: boolean;

  /** 当前 Provider 的共享存储是否已经初始化。 */
  private initialized = false;

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
    this.city_memory_available = options.city_memory_available === true;
  }

  /** 初始化 Adapter 和默认索引投影。 */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const created_storage = !this.storage;
    const storage = this.storage ?? await this.create_storage?.();
    if (!storage) throw new Error("BuiltinMemoryProvider storage factory returned no Adapter");
    this.storage = storage;
    try {
      await storage.initialize();
    } catch (error) {
      if (created_storage) {
        await storage.dispose().catch(() => undefined);
        this.storage = undefined;
      }
      throw error;
    }
    this.initialized = true;
  }

  /** 返回 Provider 状态与可重建统计。 */
  async status(access: MemoryAccessContext): Promise<MemoryStatusResult> {
    this.assert_access(access);
    await this.ensure_agent_index(access);
    const address = resolve_writable_memory_address(access, "agent");
    const [wiki_entries, evidence_entries, capture_entries] = await Promise.all([
      this.active_storage.list(`${address.prefix}/wiki`),
      this.active_storage.list(`${address.prefix}/evidence`),
      this.active_storage.list(`${address.prefix}/capture-jobs`),
    ]);
    const chunk_count = [...wiki_entries, ...evidence_entries]
      .map((entry) => storage_entry_to_record(entry, access))
      .reduce((count, memory) => count + chunk_memory_record(memory).length, 0);
    return {
      provider: this.name,
      state: "ready",
      capabilities: this.capabilities,
      details: {
        storage_adapter: this.active_storage.name,
        agent_memories: wiki_entries.length,
        city_memory_available: this.city_memory_available,
        evidence: evidence_entries.length,
        pending_capture_jobs: capture_entries.length,
        chunks: chunk_count,
      },
    };
  }

  /** 使用确定性扫描召回记忆，底层存储形态对调用方不可见。 */
  async recall(input: MemoryRecallInput): Promise<MemoryRecallResult> {
    this.assert_access(input.access);
    await this.ensure_agent_index(input.access);
    const query = String(input.query || "").trim();
    if (!query) return { provider: this.name, items: [] };
    const tokens = tokenize_memory_query(query);
    if (tokens.length === 0) return { provider: this.name, items: [] };
    const addresses = resolve_readable_memory_addresses(input.access);
    const entries = (await Promise.all(addresses.map(async (address) => [
      ...await this.active_storage.list(`${address.prefix}/wiki`),
      ...(input.include_evidence
        ? await this.active_storage.list(`${address.prefix}/evidence`)
        : []),
    ]))).flat();
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
      .map((entry) => storage_entry_to_record(entry, input.access))
      .flatMap((memory) => chunk_memory_record(memory))
      .map((chunk): MemoryRecallItem => {
        const score = score_memory_chunk(chunk.text, tokens);
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
    this.assert_access(input.access);
    const memory_id = normalize_memory_id(input.memory_id);
    resolve_readable_memory_address(input.access, memory_id);
    const content = await this.active_storage.read(memory_id_to_key(memory_id));
    if (content === null) return { memory_id, memory: null };
    const base = storage_entry_to_record({
      key: memory_id_to_key(memory_id),
      content,
    }, input.access);
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

  /** 按当前访问上下文枚举可读记忆。 */
  async list(input: MemoryListInput): Promise<MemoryListResult> {
    this.assert_access(input.access);
    await this.ensure_agent_index(input.access);
    const subject_kinds = normalize_subject_kinds(input.subject_kinds);
    const memory_types = normalize_memory_types(input.memory_types);
    const include_evidence = input.include_evidence === true;
    const addresses = resolve_readable_memory_addresses(input.access);
    const collected = (await Promise.all(addresses.map(async (address) => {
      const [wiki_entries, evidence_entries] = await Promise.all([
        this.active_storage.list(`${address.prefix}/wiki`),
        include_evidence
          ? this.active_storage.list(`${address.prefix}/evidence`)
          : Promise.resolve([]),
      ]);
      return [...wiki_entries, ...evidence_entries]
        .map((entry) => to_memory_list_item(storage_entry_to_record(entry, input.access), entry.key));
    }))).flat();
    const subject_counts = count_memory_subjects(collected);
    const filtered = collected
      .filter((item) => subject_kinds.size === 0 || subject_kinds.has(item.subject.kind))
      .filter((item) => memory_types.size === 0 || memory_types.has(item.memory_type))
      .sort((left, right) => {
        if (left.observed_at !== right.observed_at) {
          return right.observed_at.localeCompare(left.observed_at);
        }
        return left.memory_id.localeCompare(right.memory_id);
      });
    const limit = normalize_list_limit(input.limit);
    const offset = normalize_list_offset(input.offset);
    return {
      provider: this.name,
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      subject_counts,
    };
  }

  /** 保存原始证据并形成或更新长期记忆。 */
  async remember(input: MemoryRememberInput): Promise<MemoryRememberResult> {
    this.assert_access(input.access);
    await this.ensure_agent_index(input.access);
    const address = resolve_writable_memory_address(input.access, input.target);
    const content = String(input.content || "").trim();
    if (!content) throw new Error("Memory remember requires content");
    const evidence_id = create_subject_memory_id(
      address,
      `evidence/manual/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`,
    );
    await this.write_evidence(evidence_id, content, address, input.source || "manual");
    const memory_id = create_subject_memory_id(
      address,
      `wiki/${slugify(input.topic || "inbox")}`,
    );
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
      const target_memory_id = await this.write_projection({
        memory_id: revised.memory_id || memory_id,
        title: input.topic || "Memory Inbox",
        content: revised.content,
      }, source_refs, input.memory_type || "fact", address);
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
      address,
    });
    return {
      memory_id,
      evidence_id,
      mode: existing ? "updated" : "created",
    };
  }

  /** 保存 Session 证据，并通过可选 handler 形成长期投影。 */
  async digest(input: MemoryDigestInput): Promise<MemoryDigestResult> {
    this.assert_access(input.access);
    await this.ensure_agent_index(input.access);
    const address = resolve_writable_memory_address(input.access, "agent");
    const session_id = String(input.session_id || "").trim();
    if (!session_id) throw new Error("Memory digest requires session_id");
    const transcript = String(input.transcript || "").trim();
    if (!transcript) throw new Error("Memory digest requires transcript content");
    const evidence_id = create_subject_memory_id(
      address,
      `evidence/session/${slugify(session_id)}/${randomUUID()}`,
    );
    await this.write_evidence(evidence_id, transcript, address, `session:${session_id}`);
    const source_refs: MemorySourceReference[] = [{
      source_id: evidence_id,
      source_type: "session",
      label: session_id,
    }];

    if (this.digest_handler) {
      const index_content = await this.active_storage.read(memory_id_to_key(
        create_subject_memory_id(address, INDEX_RELATIVE_MEMORY_ID),
      ));
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
          address,
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

    const memory_id = create_subject_memory_id(address, "wiki/session-digests");
    await this.append_projection({
      memory_id,
      title: "Session Digests",
      content: transcript,
      source_refs,
      memory_type: "episode",
      address,
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
    this.assert_access(input.access);
    const memory_id = normalize_memory_id(input.memory_id);
    const address = resolve_readable_memory_address(input.access, memory_id);
    this.assert_address_writable(input.access, address);
    const instruction = String(input.instruction || "").trim();
    if (!instruction) throw new Error("Memory revise requires instruction");
    const evidence = String(input.evidence || "").trim();
    const existing = await this.active_storage.read(memory_id_to_key(memory_id));
    if (existing === null) throw new Error(`Memory not found: ${memory_id}`);
    const metadata = parse_metadata(existing, "document");
    const evidence_id = evidence
      ? create_subject_memory_id(
          address,
          `evidence/manual/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`,
        )
      : undefined;
    const source_refs = [...metadata.source_refs];
    if (evidence_id) {
      await this.write_evidence(
        evidence_id,
        evidence,
        address,
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
      const target_memory_id = await this.write_projection({
        memory_id: revised.memory_id || memory_id,
        title: String(metadata.title || memory_id),
        content: revised.content,
      }, source_refs, metadata.memory_type, address);
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
    this.assert_access(input.access);
    const memory_id = normalize_memory_id(input.memory_id);
    const address = resolve_readable_memory_address(input.access, memory_id);
    this.assert_address_writable(input.access, address);
    const key = memory_id_to_key(memory_id);
    const forgotten = await this.active_storage.has(key);
    await this.active_storage.delete(key);
    return { memory_id, forgotten };
  }

  /** 从稳定候选投影中生成有界 system context。 */
  async system_context(
    input: MemorySystemContextInput,
  ): Promise<MemorySystemContextResult> {
    this.assert_access(input.access);
    await this.ensure_agent_index(input.access);
    const max_items = Math.max(0, Math.floor(input.max_items));
    const max_chars = Math.max(0, Math.floor(input.max_chars || DEFAULT_MAX_CONTEXT_CHARS));
    if (max_items === 0 || max_chars === 0) return { items: [] };
    const relative_candidates = [
      "wiki/user-preferences",
      "wiki/project-overview",
      "wiki/rules",
      INDEX_RELATIVE_MEMORY_ID,
    ];
    const items: MemorySystemContextItem[] = [];
    let remaining_chars = max_chars;
    for (const address of resolve_readable_memory_addresses(input.access)) {
      for (const relative_memory_id of relative_candidates) {
        const memory_id = create_subject_memory_id(address, relative_memory_id);
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
          subject: address.subject,
          content: bounded_content,
          citation: create_citation(memory_id),
        });
        remaining_chars -= bounded_content.length;
        if (items.length >= max_items || remaining_chars <= 0) break;
      }
      if (items.length >= max_items || remaining_chars <= 0) break;
    }
    return { items };
  }

  /** 原子、幂等地保存等待后续 Formation 的最小 Turn Capture Job。 */
  async capture_turn(
    input: MemoryCaptureTurnInput,
  ): Promise<MemoryCaptureTurnResult> {
    this.assert_access(input.access);
    const session_id = String(input.session_id || "").trim();
    const turn_id = String(input.turn_id || "").trim();
    if (!session_id || !turn_id) {
      throw new Error("Memory capture_turn requires session_id and turn_id");
    }
    const messages = (Array.isArray(input.messages) ? input.messages : [])
      .flatMap((message) => {
        const message_id = String(message.message_id || "").trim();
        const text = String(message.text || "").trim();
        if (!message_id || !text) return [];
        if (message.role !== "user" && message.role !== "agent") return [];
        return [{ message_id, role: message.role, text }];
      });
    if (messages.length === 0) {
      throw new Error("Memory capture_turn requires canonical text messages");
    }
    const job_id = createHash("sha256")
      .update(`${session_id}\u0000${turn_id}`)
      .digest("hex");
    const address = resolve_writable_memory_address(input.access, "agent");
    const key = `${address.prefix}/capture-jobs/${job_id}.json`;
    if (await this.active_storage.has(key)) {
      return { job_id, mode: "existing", status: "pending" };
    }
    await this.active_storage.write(key, JSON.stringify({
      schema_version: 1,
      job_id,
      status: "pending",
      agent_id: input.access.agent_id,
      workspace_id: input.access.workspace_id,
      user_id: input.access.user_id,
      city_id: input.access.city_id,
      session_id,
      turn_id,
      messages,
      created_at: new Date().toISOString(),
    }, null, 2));
    return { job_id, mode: "created", status: "pending" };
  }

  /** 释放底层 Adapter 并关闭当前绑定。 */
  async dispose(): Promise<void> {
    try {
      await this.storage?.dispose();
    } finally {
      if (this.create_storage) this.storage = undefined;
      this.initialized = false;
    }
  }

  /** 返回当前已创建的唯一 Storage Adapter。 */
  private get active_storage(): MemoryStorageAdapter {
    if (!this.storage) throw new Error("BuiltinMemoryProvider storage is not initialized");
    return this.storage;
  }

  /** 校验访问上下文完整，并且没有伪造 City 能力。 */
  private assert_access(access: MemoryAccessContext): void {
    if (!this.initialized) throw new Error("BuiltinMemoryProvider is not initialized");
    if (!String(access.agent_id || "").trim()) throw new Error("Memory access requires agent_id");
    if (access.city_memory_available && !this.city_memory_available) {
      throw new Error("Memory access cannot enable an unavailable City Store");
    }
  }

  /** revise/forget 只允许当前 Agent、User 或 Workspace，拒绝直接修改 City Shared。 */
  private assert_address_writable(
    access: MemoryAccessContext,
    address: MemorySubjectAddress,
  ): void {
    const targets: MemoryWriteTarget[] = ["agent", "current_user", "current_workspace"];
    const writable = targets.some((target) => {
      try {
        return resolve_writable_memory_address(access, target).prefix === address.prefix;
      } catch {
        return false;
      }
    });
    if (!writable) {
      throw new Error(`Memory Subject is read-only in the current access context: ${address.prefix}`);
    }
  }

  /** 为首次访问当前 Agent 的共享 Provider 创建稳定索引。 */
  private async ensure_agent_index(access: MemoryAccessContext): Promise<void> {
    const address = resolve_writable_memory_address(access, "agent");
    const index_memory_id = create_subject_memory_id(address, INDEX_RELATIVE_MEMORY_ID);
    if (await this.active_storage.has(memory_id_to_key(index_memory_id))) return;
    await this.write_projection({
      memory_id: INDEX_RELATIVE_MEMORY_ID,
      title: "Memory Index",
      content: "Long-term memories are available through MemoryPower recall and read actions.",
      tags: ["memory", "index"],
    }, [], "document", address);
  }

  /** 保存一条 Provider 内部证据记录。 */
  private async write_evidence(
    evidence_id: string,
    content: string,
    address: MemorySubjectAddress,
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
      tags: ["memory", "evidence", address.subject.kind],
    }));
  }

  /** 创建或替换一条长期记忆投影。 */
  private async write_projection(
    projection: BuiltinMemoryProjectionDraft,
    source_refs: MemorySourceReference[],
    memory_type: MemoryType,
    address: MemorySubjectAddress,
  ): Promise<string> {
    const requested_memory_id = String(
      projection.memory_id || `wiki/${slugify(projection.title || "inbox")}`,
    ).trim();
    const memory_id = requested_memory_id.startsWith("wiki/")
      ? create_subject_memory_id(address, requested_memory_id)
      : normalize_memory_id(requested_memory_id);
    if (!memory_id.startsWith(`${address.prefix}/wiki/`)) {
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
    address: MemorySubjectAddress;
  }): Promise<void> {
    const memory_id = normalize_memory_id(input.memory_id);
    const key = memory_id_to_key(memory_id);
    const existing = await this.active_storage.read(key);
    if (existing === null) {
      await this.write_projection({
        memory_id,
        title: input.title,
        content: input.content,
      }, input.source_refs, input.memory_type, input.address);
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
