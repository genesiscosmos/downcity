/**
 * Session Message 的 Active + Segment JSONL 存储。
 *
 * Active 保存上次 Compact 后产生的真实 Message；Compact 把 Active 前缀写入按
 * sequence 范围命名的不可变 Segment，并在 Segment 末尾追加累计 Summary footer。
 */

import fs from "fs-extra";
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { generateId } from "@/utils/Id.js";
import type { SessionAssistantMessage, SessionMessage } from "@/types/session/SessionMessage.js";
import type {
  SessionMessageStorageStats,
  SessionSegmentRange,
  SessionSegmentSnapshot,
  SessionSegmentSummary,
} from "@/types/session/SessionSegment.js";
import type {
  CompactActiveMessagesInput,
  CompactActiveMessagesResult,
  SessionMessageCommitState,
} from "@/types/store/SessionStore.js";
import type { JsonlSessionMessageStoreOptions } from "@/types/store/LocalStore.js";

const SEGMENT_FILE_PATTERN = /^(\d+)-(\d+)\.jsonl$/;
const SEQUENCE_FILE_WIDTH = 12;

/** Active + Segment JSONL 存储。 */
export class JsonlSessionMessageStore {
  readonly session_id: string;
  readonly active_file_path: string;
  readonly assistant_message_file_path: string;
  readonly segments_dir_path: string;

  private readonly lock_file_path: string;

  constructor(options: JsonlSessionMessageStoreOptions) {
    this.session_id = String(options.session_id || "").trim();
    this.active_file_path = path.resolve(options.file_path);
    this.assistant_message_file_path = path.resolve(
      options.assistant_message_file_path ||
        path.join(path.dirname(this.active_file_path), "assistant_message.json"),
    );
    this.segments_dir_path = path.join(path.dirname(this.active_file_path), "segments");
    this.lock_file_path = `${this.active_file_path}.lock`;
    if (!this.session_id) throw new Error("JsonlSessionMessageStore requires session_id");
  }

  /** 创建 Active 与 Segment 布局，并清理已经完成的遗留草稿。 */
  async initialize(): Promise<void> {
    await this.with_write_lock(async () => {
      const ranges = await this.list_segment_ranges();
      const folded_messages = await this.read_folded_active_messages_unsafe();
      const latest_segment_end = ranges.at(-1)?.end_sequence || 0;
      const messages = folded_messages.filter(
        (message) => message.sequence > latest_segment_end,
      );

      // Compact 先落 Segment 再覆盖 Active。若进程在两步之间退出，重启时按
      // Segment sequence 边界清除 Active 重叠前缀，保证不丢消息且上下文不重复。
      if (messages.length !== folded_messages.length) {
        await this.write_active_messages_unsafe(messages);
      }

      const draft = await this.read_assistant_message();
      if (draft && draft.session_id !== this.session_id) {
        throw new Error("assistant_message.json session_id mismatch");
      }
      const finalized = draft && messages.find(
        (message) => message.message_id === draft.message_id,
      );
      const effective_draft = draft && finalized?.type === "assistant" &&
        finalized.revision >= draft.revision &&
        finalized.status !== "streaming"
        ? null
        : draft;
      this.validate_runtime_sequence(
        effective_draft ? [...messages, effective_draft] : messages,
        latest_segment_end,
      );
      if (
        draft &&
        finalized?.type === "assistant" &&
        finalized.revision >= draft.revision &&
        finalized.status !== "streaming"
      ) {
        await fs.remove(this.assistant_message_file_path);
      }
    });
  }

  /** 读取 Active 和当前 Assistant 草稿，并按 revision 折叠。 */
  async list_messages(): Promise<SessionMessage[]> {
    await this.ensure_layout();
    const by_id = new Map(
      (await this.read_active_messages_unsafe()).map((message) => [message.message_id, message]),
    );
    const draft = await this.read_assistant_message();
    if (draft) {
      const previous = by_id.get(draft.message_id);
      if (!previous || draft.revision > previous.revision) by_id.set(draft.message_id, draft);
    }
    const messages = [...by_id.values()].sort(compare_message_sequence);
    const ranges = await this.list_segment_ranges();
    this.validate_runtime_sequence(messages, ranges.at(-1)?.end_sequence || 0);
    return messages;
  }

  /** 读取指定 sequence 之前最近的完整 Segment。 */
  async read_segment_before(before_sequence: number): Promise<SessionSegmentSnapshot | null> {
    const boundary = Number(before_sequence);
    if (!Number.isFinite(boundary)) return null;
    const ranges = await this.list_segment_ranges();
    const range = [...ranges].reverse().find((item) => item.end_sequence < boundary);
    return range ? await this.read_segment(range) : null;
  }

  /** 读取最新已关闭 Segment 的累计 Summary。 */
  async read_latest_summary(): Promise<SessionSegmentSummary | null> {
    const ranges = await this.list_segment_ranges();
    const latest = ranges[ranges.length - 1];
    return latest ? (await this.read_segment(latest)).summary : null;
  }

  /** 读取全部真实历史，供 Fork 等明确需要完整复制的操作使用。 */
  async list_history_messages(): Promise<SessionMessage[]> {
    const ranges = await this.list_segment_ranges();
    const messages: SessionMessage[] = [];
    for (const range of ranges) {
      messages.push(...(await this.read_segment(range)).messages);
    }
    messages.push(...(await this.list_messages()));
    return messages.sort(compare_message_sequence);
  }

  /** 读取当前存储统计，不解析与当前操作无关的旧 Segment 正文。 */
  async stats(): Promise<SessionMessageStorageStats> {
    const ranges = await this.list_segment_ranges();
    const active_messages = await this.list_messages();
    const latest_range = ranges[ranges.length - 1];
    const latest_message = active_messages[active_messages.length - 1] ||
      (latest_range ? (await this.read_segment(latest_range)).messages.at(-1) : null) ||
      null;
    const paths = [this.active_file_path, ...ranges.map((range) => range.file_path)];
    const sizes = await Promise.all(
      paths.map(async (file_path) => await stat(file_path).then((value) => value.size).catch(() => 0)),
    );
    const latest_sequence = Math.max(
      latest_range?.end_sequence || 0,
      active_messages.reduce((max, message) => Math.max(max, message.sequence), 0),
    );
    return {
      message_count: latest_sequence,
      history_bytes: sizes.reduce((total, size) => total + size, 0),
      latest_message,
    };
  }

  /** 判断给定边界之前是否仍存在历史 Segment。 */
  async has_segment_before(before_sequence: number): Promise<boolean> {
    return (await this.list_segment_ranges()).some(
      (range) => range.end_sequence < before_sequence,
    );
  }

  /** 返回当前 Active 之前的读取边界。 */
  async active_before_sequence(messages: SessionMessage[]): Promise<number | undefined> {
    const first = messages[0];
    if (first) return first.sequence;
    const ranges = await this.list_segment_ranges();
    const latest = ranges[ranges.length - 1];
    return latest ? latest.end_sequence + 1 : undefined;
  }

  /** 读取当前运行中的 Assistant 草稿。 */
  async read_assistant_message(): Promise<SessionAssistantMessage | null> {
    try {
      const value = await fs.readJson(this.assistant_message_file_path) as SessionAssistantMessage;
      this.validate_message(value);
      return value.type === "assistant" && value.status === "streaming" ? value : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  /** 原子覆盖运行中的 Assistant 草稿。 */
  async write_assistant_message(message: SessionAssistantMessage): Promise<void> {
    this.validate_message(message);
    if (message.status !== "streaming") throw new Error("Assistant draft must be streaming");
    await this.with_write_lock(async () => {
      const current = await this.read_assistant_message();
      if (!current || current.message_id !== message.message_id) {
        throw new Error(`Assistant draft does not exist: ${message.message_id}`);
      }
      if (message.revision !== current.revision + 1) {
        throw new Error(`Invalid Assistant draft revision: ${message.message_id}`);
      }
      await this.write_assistant_message_unsafe(message);
    });
  }

  /** 在写锁内分配全局 sequence 并创建唯一 Assistant 草稿。 */
  async create_assistant_message(
    build_message: (state: SessionMessageCommitState) => SessionAssistantMessage,
  ): Promise<SessionAssistantMessage> {
    return await this.with_write_lock(async () => {
      const current = await this.read_assistant_message();
      if (current) throw new Error(`Assistant draft already exists: ${current.message_id}`);
      const messages = await this.read_active_messages_unsafe();
      const ranges = await this.list_segment_ranges();
      this.validate_runtime_sequence(messages, ranges.at(-1)?.end_sequence || 0);
      const message = build_message({
        message_sequence: await this.next_sequence_unsafe(messages),
        messages,
      });
      this.validate_message(message);
      if (message.status !== "streaming" || message.revision !== 1) {
        throw new Error("New Assistant draft must be streaming at revision 1");
      }
      await this.write_assistant_message_unsafe(message);
      return message;
    });
  }

  /** 创建新 Message 或向 Active 追加已有 Message revision。 */
  async append_message(
    build_message: (state: SessionMessageCommitState) => SessionMessage,
  ): Promise<SessionMessage> {
    return await this.with_write_lock(async () => {
      const messages = await this.read_active_messages_unsafe();
      const draft = await this.read_assistant_message();
      const current_messages = draft ? [...messages, draft] : messages;
      const ranges = await this.list_segment_ranges();
      this.validate_runtime_sequence(
        current_messages,
        ranges.at(-1)?.end_sequence || 0,
      );
      const message = build_message({
        message_sequence: await this.next_sequence_unsafe(current_messages),
        messages: current_messages,
      });
      this.validate_message(message);
      await fs.appendFile(this.active_file_path, `${JSON.stringify(message)}\n`, "utf8");
      return message;
    });
  }

  /** 将 Assistant 草稿最终追加到 Active，并删除草稿文件。 */
  async finalize_assistant_message(message: SessionAssistantMessage): Promise<void> {
    this.validate_message(message);
    if (message.status === "streaming") throw new Error("Final Assistant message cannot be streaming");
    await this.with_write_lock(async () => {
      const current = await this.read_assistant_message();
      if (!current || current.message_id !== message.message_id) {
        throw new Error(`Assistant draft does not exist: ${message.message_id}`);
      }
      if (message.revision !== current.revision + 1) {
        throw new Error(`Invalid final Assistant revision: ${message.message_id}`);
      }
      await fs.appendFile(this.active_file_path, `${JSON.stringify(message)}\n`, "utf8");
      await fs.remove(this.assistant_message_file_path);
    });
  }

  /** 把 Active 前缀与累计 Summary 提交为不可变 Segment。 */
  async compact_active(
    input: CompactActiveMessagesInput,
  ): Promise<CompactActiveMessagesResult> {
    return await this.with_write_lock(async () => {
      const draft = await this.read_assistant_message();
      if (draft) throw new Error("Cannot compact while Assistant is streaming");
      const active_messages = await this.read_active_messages_unsafe();
      const ranges = await this.list_segment_ranges();
      this.validate_runtime_sequence(
        active_messages,
        ranges.at(-1)?.end_sequence || 0,
      );
      const segment_messages = active_messages.filter(
        (message) => message.sequence <= input.through_sequence,
      );
      const retained_messages = active_messages.filter(
        (message) => message.sequence > input.through_sequence,
      );
      if (segment_messages.length === 0) {
        throw new Error("Compact boundary does not include Active messages");
      }
      const start_sequence = segment_messages[0].sequence;
      const end_sequence = segment_messages.at(-1)?.sequence || 0;
      if (input.summary.through_sequence !== end_sequence) {
        throw new Error("Compact Summary boundary does not match Segment end");
      }
      const range: SessionSegmentRange = {
        start_sequence,
        end_sequence,
        file_path: this.segment_file_path(start_sequence, end_sequence),
      };
      if (await fs.pathExists(range.file_path)) {
        throw new Error(`Session Segment already exists: ${range.file_path}`);
      }
      await this.write_segment_unsafe(range, segment_messages, input.summary);
      await this.write_active_messages_unsafe(retained_messages);
      return {
        segment: { range, messages: segment_messages, summary: input.summary },
        active_messages: retained_messages,
      };
    });
  }

  /** 扫描 Segment 文件名并返回 sequence 升序索引。 */
  async list_segment_ranges(): Promise<SessionSegmentRange[]> {
    await this.ensure_layout();
    const entries = await fs.readdir(this.segments_dir_path, { withFileTypes: true });
    const ranges = entries
      .flatMap<SessionSegmentRange>((entry) => {
        if (!entry.isFile()) return [];
        const match = SEGMENT_FILE_PATTERN.exec(entry.name);
        if (!match) return [];
        const start_sequence = Number(match[1]);
        const end_sequence = Number(match[2]);
        if (!Number.isInteger(start_sequence) || !Number.isInteger(end_sequence)) return [];
        return [{
          start_sequence,
          end_sequence,
          file_path: path.join(this.segments_dir_path, entry.name),
        }];
      })
      .sort((left, right) => left.start_sequence - right.start_sequence);
    for (let index = 0; index < ranges.length; index += 1) {
      const range = ranges[index];
      const previous = ranges[index - 1];
      if (!range || range.start_sequence > range.end_sequence) {
        throw new Error("Session Segment filename contains an invalid sequence range");
      }
      if (index === 0 && range.start_sequence !== 1) {
        throw new Error("The first Session Segment must start at sequence 1");
      }
      if (previous && range.start_sequence !== previous.end_sequence + 1) {
        throw new Error("Session Segment sequence ranges must be contiguous and non-overlapping");
      }
    }
    return ranges;
  }

  /** 读取并验证一个不可变 Segment。 */
  private async read_segment(range: SessionSegmentRange): Promise<SessionSegmentSnapshot> {
    const raw = await fs.readFile(range.file_path, "utf8");
    const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
    const summary_value = JSON.parse(lines.pop() || "null") as SessionSegmentSummary | null;
    this.validate_summary(summary_value, range.end_sequence);
    const messages = lines.map((line) => {
      const message = JSON.parse(line) as SessionMessage;
      this.validate_message(message);
      return message;
    }).sort(compare_message_sequence);
    if (
      messages.length !== range.end_sequence - range.start_sequence + 1 ||
      messages[0]?.sequence !== range.start_sequence ||
      messages.at(-1)?.sequence !== range.end_sequence ||
      messages.some(
        (message, index) => message.sequence !== range.start_sequence + index,
      )
    ) {
      throw new Error(`Session Segment range mismatch: ${range.file_path}`);
    }
    return { range, messages, summary: summary_value as SessionSegmentSummary };
  }

  /** 读取 Active 中每个 Message 的最高 revision。 */
  private async read_active_messages_unsafe(): Promise<SessionMessage[]> {
    const messages = await this.read_folded_active_messages_unsafe();
    const ranges = await this.list_segment_ranges();
    const latest_segment_end = ranges.at(-1)?.end_sequence || 0;
    const active_messages = messages.filter(
      (message) => message.sequence > latest_segment_end,
    );
    return active_messages;
  }

  /** 读取 Active 原始行，并按 Message ID 保留最高 revision。 */
  private async read_folded_active_messages_unsafe(): Promise<SessionMessage[]> {
    const raw = await fs.readFile(this.active_file_path, "utf8").catch(() => "");
    const by_id = new Map<string, SessionMessage>();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const message = JSON.parse(line) as SessionMessage;
      this.validate_message(message);
      const previous = by_id.get(message.message_id);
      if (!previous || message.revision > previous.revision) by_id.set(message.message_id, message);
    }
    return [...by_id.values()].sort(compare_message_sequence);
  }

  /** 计算下一条真实 Message sequence。 */
  private async next_sequence_unsafe(messages: SessionMessage[]): Promise<number> {
    const ranges = await this.list_segment_ranges();
    return Math.max(
      ranges.at(-1)?.end_sequence || 0,
      messages.reduce((max, message) => Math.max(max, message.sequence), 0),
    ) + 1;
  }

  /** 原子覆盖 Assistant 草稿。 */
  private async write_assistant_message_unsafe(message: SessionAssistantMessage): Promise<void> {
    const temporary_path = `${this.assistant_message_file_path}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeJson(temporary_path, message, { spaces: 2 });
    await fs.move(temporary_path, this.assistant_message_file_path, { overwrite: true });
  }

  /** 原子覆盖 Active，只写入每个 Message 的最终 revision。 */
  private async write_active_messages_unsafe(messages: SessionMessage[]): Promise<void> {
    const temporary_path = `${this.active_file_path}.${process.pid}.${Date.now()}.tmp`;
    const content = messages.length > 0
      ? `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`
      : "";
    await fs.writeFile(temporary_path, content, "utf8");
    await fs.move(temporary_path, this.active_file_path, { overwrite: true });
  }

  /** 原子创建一个带累计 Summary footer 的 Segment。 */
  private async write_segment_unsafe(
    range: SessionSegmentRange,
    messages: SessionMessage[],
    summary: SessionSegmentSummary,
  ): Promise<void> {
    const temporary_path = `${range.file_path}.${process.pid}.${Date.now()}.tmp`;
    const content = `${[
      ...messages.map((message) => JSON.stringify(message)),
      JSON.stringify(summary),
    ].join("\n")}\n`;
    await fs.writeFile(temporary_path, content, "utf8");
    await fs.move(temporary_path, range.file_path, { overwrite: false });
  }

  /** 生成稳定的 Segment sequence 范围文件名。 */
  private segment_file_path(start_sequence: number, end_sequence: number): string {
    const start = String(start_sequence).padStart(SEQUENCE_FILE_WIDTH, "0");
    const end = String(end_sequence).padStart(SEQUENCE_FILE_WIDTH, "0");
    return path.join(this.segments_dir_path, `${start}-${end}.jsonl`);
  }

  /** 验证真实 Session Message。 */
  private validate_message(message: SessionMessage): void {
    if (!message || typeof message !== "object") throw new Error("message must be an object");
    if (message.session_id !== this.session_id) throw new Error("session_id mismatch");
    if (!message.message_id || !Number.isInteger(message.sequence) || !Number.isInteger(message.revision)) {
      throw new Error("message identity, sequence and revision are required");
    }
    if (message.type === "assistant") {
      const sequences = new Set<number>();
      for (const part of message.parts) {
        if (!Number.isInteger(part.sequence) || sequences.has(part.sequence)) {
          throw new Error(`invalid Assistant part sequence: ${part.part_id}`);
        }
        sequences.add(part.sequence);
      }
    }
  }

  /** 验证 Segment footer Summary。 */
  private validate_summary(
    summary: SessionSegmentSummary | null,
    expected_sequence: number,
  ): asserts summary is SessionSegmentSummary {
    if (!summary || summary.record_type !== "summary") {
      throw new Error("Session Segment summary footer is required");
    }
    if (summary.session_id !== this.session_id || !summary.summary_id) {
      throw new Error("Session Segment summary identity mismatch");
    }
    if (summary.through_sequence !== expected_sequence || !String(summary.text || "").trim()) {
      throw new Error("Session Segment summary boundary is invalid");
    }
  }

  /** 验证 Active 与草稿合并后紧接最新 Segment，且真实 Message sequence 连续。 */
  private validate_runtime_sequence(
    messages: SessionMessage[],
    latest_segment_end: number,
  ): void {
    const ordered_messages = [...messages].sort(compare_message_sequence);
    if (ordered_messages.some(
      (message, index) => message.sequence !== latest_segment_end + index + 1,
    )) {
      throw new Error("Active and draft Session Message sequences must be contiguous");
    }
  }

  /** 创建 Active、Segment 与锁所需目录。 */
  private async ensure_layout(): Promise<void> {
    await fs.ensureDir(path.dirname(this.active_file_path));
    await fs.ensureDir(this.segments_dir_path);
    await fs.ensureFile(this.active_file_path);
  }

  /** 使用同目录锁串行化 Active、草稿与 Segment 写入。 */
  private async with_write_lock<T>(callback: () => Promise<T>): Promise<T> {
    await this.ensure_layout();
    const token = `${process.pid}:${Date.now()}:${generateId()}`;
    const stale_ms = 30_000;
    const started_at = Date.now();
    while (true) {
      try {
        const file = await open(this.lock_file_path, "wx");
        await file.writeFile(token, "utf8");
        await file.close();
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const lock_stat = await stat(this.lock_file_path);
          if (Date.now() - lock_stat.mtimeMs > stale_ms) await fs.remove(this.lock_file_path);
        } catch { /* 锁文件可能刚被释放。 */ }
        if (Date.now() - started_at > stale_ms * 2) {
          throw new Error(`Session message lock timeout: ${this.lock_file_path}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }
    try {
      return await callback();
    } finally {
      try {
        if ((await readFile(this.lock_file_path, "utf8")).trim() === token) {
          await fs.remove(this.lock_file_path);
        }
      } catch { /* 锁已被清理。 */ }
    }
  }
}

/** 按全局 Message sequence 升序排序。 */
function compare_message_sequence(left: SessionMessage, right: SessionMessage): number {
  return left.sequence - right.sequence;
}
