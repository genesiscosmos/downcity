/**
 * 统一日志实现（控制台 + JSONL 落盘）。
 *
 * 关键点（中文）
 * - 支持按项目根目录动态绑定日志目录。
 * - 结构化字段写入 JSONL，便于后续检索与审计。
 */

import { get_logs_dir_path } from "@/workspace/WorkspacePaths.js";
import { get_timestamp } from "@/utils/Time.js";
import type { JsonObject } from "@/types/common/Json.js";
import type { FileSystem } from "@/types/workspace/FileSystem.js";
import { LocalFileSystem } from "@/workspace/LocalFileSystem.js";

type LogDetails = {
  [key: string]: JsonObject[keyof JsonObject] | undefined;
};

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const TASK_BRACKET_COLOR = "\x1b[95m"; // bright magenta
const ALLOWED_MESSAGE_LABELS = new Set([
  "main",
  "system",
  "user",
  "assistant",
  "tool",
  "tool_result",
  "agent",
]);
const FIXED_BRACKET_COLORS: Record<string, string> = {
  INFO: "\x1b[36m", // cyan
  WARN: "\x1b[33m", // yellow
  ERROR: "\x1b[31m", // red
  DEBUG: "\x1b[90m", // gray
  ACTION: "\x1b[96m", // bright cyan
  SYSTEM: "\x1b[90m", // gray
  USER: "\x1b[33m", // yellow
  ASSISTANT: "\x1b[32m", // green
  TOOL: "\x1b[95m", // bright magenta
  TOOL_RESULT: "\x1b[34m", // blue
  AGENT: "\x1b[36m", // cyan
  MAIN: "\x1b[90m", // gray
};
const BRACKET_COLOR_PALETTE = [
  "\x1b[36m", // cyan
  "\x1b[32m", // green
  "\x1b[35m", // magenta
  "\x1b[34m", // blue
  "\x1b[33m", // yellow
  "\x1b[96m", // bright cyan
];

function normalizeLogDetails(details?: LogDetails): JsonObject | undefined {
  if (!details) return undefined;
  const normalized: JsonObject = {};
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function hashText(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function colorizeBracketedPrefix(label: string): string {
  const normalized = String(label || "").trim().toUpperCase();
  const baseLabel = normalized.split(/[.\s]+/)[0].replace(/[^A-Z0-9_]/g, "");
  // 关键点（中文）：task 日志标签使用固定高可见色，避免随机色导致辨识度不稳定。
  if (normalized === "TASK") {
    return `${TASK_BRACKET_COLOR}[${label}]${ANSI_RESET}`;
  }
  const fixedColor = FIXED_BRACKET_COLORS[normalized] || FIXED_BRACKET_COLORS[baseLabel];
  if (fixedColor) {
    return `${fixedColor}[${label}]${ANSI_RESET}`;
  }
  const color = BRACKET_COLOR_PALETTE[hashText(label) % BRACKET_COLOR_PALETTE.length];
  return `${color}[${label}]${ANSI_RESET}`;
}

function colorizeMessageBracketPrefixes(message: string): string {
  // 关键点（中文）：紧凑单行展示时，给消息中的标签 token 着色，正文保持原样。
  return String(message || "").replace(/\[([^\]\n]+)\]/g, (full, label: string) => {
    const normalized = String(label || "").trim();
    const base = normalized
      .toUpperCase()
      .split(/[.\s:]+/)[0]
      .replace(/[^A-Z0-9_]/g, "");
    if (!base || !/[A-Z]/.test(base)) return full;
    return colorizeBracketedPrefix(normalized);
  });
}

/**
 * 压缩日志为“可分段的紧凑展示”。
 *
 * 关键点（中文）
 * - 段内换行转义为字面量 `\n`，避免一条消息占多行。
 * - 段与段之间保留真实换行，确保不同 message 可清晰区分。
 */
function compactMessageForConsole(message: string): string {
  const normalized = String(message || "").replace(/\r\n/g, "\n");
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => String(block || "").replace(/\n/g, "\\n").trim())
    .filter(Boolean);
  if (blocks.length === 0) return "";
  return blocks.join("\n");
}

function normalizeToAllowedMessageLabels(message: string): string {
  const normalizedLines: string[] = [];
  let activeLabel: string | null = null;

  for (const rawLine of String(message || "").split("\n")) {
    const line = String(rawLine || "");
    const trimmed = line.trim();
    if (!trimmed) {
      normalizedLines.push("");
      continue;
    }

    const matched = trimmed.match(/^\[([^\]]+)\]\s*:?\s*(.*)$/);
    if (matched) {
      const rawLabel = String(matched[1] || "").trim();
      const lowerLabel = rawLabel.toLowerCase();
      const labelToken = lowerLabel.split(/\s+/)[0] || "";
      const baseLabel = labelToken.split(".")[0];
      const content = String(matched[2] || "").trim();
      if (ALLOWED_MESSAGE_LABELS.has(baseLabel)) {
        activeLabel = baseLabel;
        const attrsRaw = rawLabel.slice(labelToken.length).trim();
        const normalizedLabel = attrsRaw ? `${baseLabel} ${attrsRaw}` : baseLabel;
        normalizedLines.push(`[${normalizedLabel}]${content ? ` ${content}` : ""}`);
      } else {
        activeLabel = "main";
        normalizedLines.push(`[main] ${content || trimmed}`);
      }
      continue;
    }

    if (activeLabel) {
      // 关键点（中文）：同一消息块的续行不重复打标签。
      normalizedLines.push(line);
      continue;
    }
    normalizedLines.push(`[main] ${trimmed}`);
  }
  if (normalizedLines.length === 0) return "[main] -";
  return normalizedLines.join("\n");
}

/**
 * Unified runtime logger for Downcity.
 *
 * Design goals:
 * - Provide a single logger interface usable by both:
 *   - system/runtime components (server, scheduler, tool executor, etc.)
 *   - agent/LLM execution (LLM request/response logging expects `logger.log(...)`)
 * - Persist logs as JSONL to `.downcity/logs/<YYYY-MM-DD>.jsonl` (one line per entry).
 * - Keep console output human-friendly, but make disk logs machine-friendly.
 *
 * Notes:
 * - `log(level, ...)` is async because it may write to disk.
 * - Convenience methods (`info/warn/...`) are sync and fire-and-forget.
 * - A small in-memory ring buffer is kept for debugging, but persistence is append-only.
 */
export interface LogEntry {
  id: string;
  timestamp: string;
  type: "info" | "warn" | "error" | "debug" | "action";
  message: string;
  details?: JsonObject;
  duration?: number;
}

/**
 * Logger：项目级日志器。
 *
 * 关键职责（中文）
 * - 控制台可读输出（开发期）
 * - JSONL 持久化输出（排障 / 审计）
 */
export class Logger {
  private logs: LogEntry[] = [];
  private logLevel: string = "info";
  private writeChain: Promise<void> = Promise.resolve();
  private readonly maxInMemoryEntries = 2000;
  private workspace_files: FileSystem | null = null;

  constructor(logLevel: string = "info") {
    this.logLevel = logLevel;
  }

  /**
   * 绑定当前 logger 实例的 project_root。
   *
   * 关键点（中文）
   * - 每个 Agent / workspace 持有独立 Logger，绑定只影响当前实例。
   * - 落盘目录必须在实例初始化后明确指定。
   * - 未绑定 project_root 时，只打印到 console，不写入 `.downcity/logs/*`。
   */
  bind_project_root(project_root: string): void {
    const root = String(project_root || "").trim();
    this.workspace_files = root ? new LocalFileSystem(root) : null;
  }

  /** 绑定现有 Workspace FileSystem，避免创建第二套文件入口。 */
  bind_workspace(files: FileSystem): void {
    this.workspace_files = files;
  }

  /**
   * Generic async logger used by agent / LLM logging.
   * Accepts `info|warn|error|debug|action` (case-insensitive).
   */
  async log(
    level: string,
    message: string,
    details?: LogDetails,
  ): Promise<void> {
    const type = this.normalizeType(level);
    await this.emit(type, message, details);
  }

  info(message: string, details?: LogDetails): void {
    void this.emit("info", message, details);
  }

  warn(message: string, details?: LogDetails): void {
    void this.emit("warn", message, details);
  }

  error(message: string, details?: LogDetails): void {
    void this.emit("error", message, details);
  }

  debug(message: string, details?: LogDetails): void {
    void this.emit("debug", message, details);
  }

  action(message: string, details?: LogDetails): void {
    void this.emit("action", message, details);
  }

  private normalizeType(level: string): LogEntry["type"] {
    const s = String(level || "")
      .trim()
      .toLowerCase();
    if (s === "warn" || s === "warning") return "warn";
    if (s === "error" || s === "err") return "error";
    if (s === "debug" || s === "trace") return "debug";
    if (s === "action") return "action";
    return "info";
  }

  /**
   * 写入策略（中文）
   * - 先写内存与控制台，再串行追加到 JSONL，避免并发写乱序。
   */
  private async emit(
    type: LogEntry["type"],
    message: string,
    details?: LogDetails,
  ): Promise<void> {
    const entry: LogEntry = {
      id: this.generate_id(),
      timestamp: get_timestamp(),
      type,
      message: normalizeToAllowedMessageLabels(message),
      details: normalizeLogDetails(details),
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxInMemoryEntries) {
      this.logs.splice(0, this.logs.length - this.maxInMemoryEntries);
    }
    this.printLog(entry);

    this.writeChain = this.writeChain
      .catch(() => {})
      .then(() => this.saveToFile(entry))
      .catch(() => {});
    await this.writeChain;
  }

  private printLog(entry: LogEntry): void {
    // 关键点（中文）：控制台输出不展示前置时间戳，减少聊天链路日志噪音。
    // 时间信息仍保存在 JSONL 落盘字段 `timestamp` 中。
    const compactBody = compactMessageForConsole(entry.message);
    const body = colorizeMessageBracketPrefixes(compactBody);
    const message = body;

    switch (entry.type) {
      case "error":
        console.error(message);
        break;
      case "warn":
        console.warn(message);
        break;
      case "debug":
        if (this.logLevel === "debug") {
          console.log(message);
        }
        break;
      case "action":
        console.log(message);
        break;
      default:
        console.log(message);
    }
  }

  /**
   * 落盘算法（中文）
   * - 日志按自然日分片：`.downcity/logs/YYYY-MM-DD.jsonl`。
   * - 每条日志一行 JSON，便于 grep / 流式消费。
   */
  private async saveToFile(entry: LogEntry): Promise<void> {
    if (!this.workspace_files) return;
    const logsDir = get_logs_dir_path(this.workspace_files.root_path);
    const date = String(entry.timestamp || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    const logFile = this.workspace_files.resolve_path(logsDir, `${date}.jsonl`);

    const logLine = JSON.stringify(entry) + "\n";
    await this.workspace_files.append_file(logFile, logLine);
  }

  private generate_id(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async save_all_logs(): Promise<void> {
    await this.writeChain.catch(() => {});
  }

  get_logs(): LogEntry[] {
    return this.logs;
  }

  get_logs_by_type(type: LogEntry["type"]): LogEntry[] {
    return this.logs.filter((log) => log.type === type);
  }

  get_recent_logs(count: number = 10): LogEntry[] {
    return this.logs.slice(-count);
  }

  clear_logs(): void {
    this.logs = [];
  }
}

/**
 * 创建独立 logger 实例。
 *
 * 说明（中文）
 * - 每次调用都返回独立实例，避免不同 Agent / workspace 互相覆盖落盘目录。
 * - 提供 project_root 时立即绑定日志目录；未提供时仅输出到 console。
 */
export function get_logger(project_root?: string, log_level?: string): Logger {
  const logger = new Logger(log_level);
  const root = String(project_root || "").trim();
  if (root) logger.bind_project_root(root);
  return logger;
}
