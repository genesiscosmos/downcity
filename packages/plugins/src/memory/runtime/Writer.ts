/**
 * Memory Writer（LLM Wiki 文件读写与路径安全）。
 *
 * 关键点（中文）
 * - `sources/` 保存原始证据，`wiki/` 保存整理后的长期记忆。
 * - 所有外部传入路径都必须限制在 Memory Plugin 自己的 `.downcity/memory` 目录内。
 * - 无 LLM 注入时使用 append fallback，保证 MemoryPlugin 仍然可用。
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { PluginContext } from "@downcity/agent";
import type {
  MemoryReadPayload,
  MemoryReadResponse,
  MemoryRevisePayload,
  MemoryReviseResponse,
  MemoryWikiPageDraft,
} from "@/memory/types/Memory.js";

function nowIso(): string {
  return new Date().toISOString();
}

function dateStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function toRelPath(rootPath: string, absPath: string): string {
  return path.relative(rootPath, absPath).replace(/\\/g, "/");
}

function isWithin(parentPath: string, childPath: string): boolean {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  if (parent === child) return true;
  return child.startsWith(`${parent}${path.sep}`);
}

function slugify(value: string): string {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return text || "inbox";
}

function normalizeMarkdownPath(value: string): string {
  const clean = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
  if (!clean) return "";
  return clean.toLowerCase().endsWith(".md") ? clean : `${clean}.md`;
}

function resolveWikiPath(context: PluginContext, requestedPath?: string, title?: string): {
  absPath: string;
  relPath: string;
} {
  const memoryRoot = path.join(context.workspace_path, ".downcity", "memory");
  const wikiRoot = path.join(memoryRoot, "wiki");
  const normalized = normalizeMarkdownPath(requestedPath || slugify(title || "inbox"));
  const withoutPrefix = normalized
    .replace(/^\.downcity\/memory\/wiki\//, "")
    .replace(/^wiki\//, "");
  const absPath = path.resolve(wikiRoot, withoutPrefix);
  if (!isWithin(wikiRoot, absPath)) {
    throw new Error("wiki path is not allowed");
  }
  return {
    absPath,
    relPath: toRelPath(context.workspace_path, absPath),
  };
}

function resolveAllowedReadPath(context: PluginContext, relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized) {
    throw new Error("path is required");
  }
  const absPath = path.resolve(context.workspace_path, normalized);
  const memoryRoot = path.resolve(path.join(context.workspace_path, ".downcity", "memory"));
  const isMemoryPath = isWithin(memoryRoot, absPath);
  if (!isMemoryPath) {
    throw new Error("path is not allowed");
  }
  if (!normalized.toLowerCase().endsWith(".md")) {
    throw new Error("path must be markdown");
  }
  return absPath;
}

function buildSourceEntry(content: string, source?: string): string {
  const clean = String(content || "").trim();
  const sourceText = source ? `Source: ${source}\n\n` : "";
  return `## ${nowIso()}\n\n${sourceText}${clean}\n`;
}

function buildFallbackWikiEntry(payload: {
  content: string;
  sourcePath?: string;
  instruction?: string;
}): string {
  const lines = [
    `## ${nowIso()}`,
    "",
    ...(payload.instruction ? [`Instruction: ${payload.instruction}`, ""] : []),
    payload.content.trim(),
    "",
    ...(payload.sourcePath ? [`Source: ${payload.sourcePath}`, ""] : []),
  ];
  return lines.join("\n");
}

function ensureFrontmatter(draft: MemoryWikiPageDraft): string {
  const content = String(draft.content || "").trim();
  if (content.startsWith("---")) {
    return `${content}\n`;
  }
  const title = String(draft.title || "Memory Page").trim();
  const tags = draft.tags && draft.tags.length > 0
    ? draft.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : ["memory"];
  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    `date: ${dateStamp()}`,
    `tags: [${tags.map((tag) => JSON.stringify(tag)).join(", ")}]`,
    "---",
    "",
    content,
    "",
  ].join("\n");
}

async function readTextIfExists(absPath: string): Promise<string> {
  try {
    return String(await fs.readFile(absPath, "utf-8"));
  } catch {
    return "";
  }
}

/**
 * 初始化 memory wiki 目录结构（幂等）。
 */
export async function ensureMemoryDirectories(rootPath: string): Promise<void> {
  const memoryRoot = path.join(rootPath, ".downcity", "memory");
  await fs.mkdir(path.join(memoryRoot, "wiki"), { recursive: true });
  await fs.mkdir(path.join(memoryRoot, "sources", "manual"), { recursive: true });
  await fs.mkdir(path.join(memoryRoot, "sources", "sessions"), { recursive: true });

  const indexPath = path.join(memoryRoot, "wiki", "index.md");
  const exists = await fs
    .access(indexPath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    await fs.writeFile(
      indexPath,
      [
        "---",
        'title: "Memory Index"',
        `date: ${dateStamp()}`,
        'tags: ["memory", "index"]',
        "---",
        "",
        "This is the root index for the agent-maintained LLM Wiki memory.",
        "",
      ].join("\n"),
      "utf-8",
    );
  }
}

/**
 * 读取指定记忆文件（支持行区间）。
 */
export async function readMemory(
  context: PluginContext,
  payload: MemoryReadPayload,
): Promise<MemoryReadResponse> {
  const requestedPath = String(payload.path || "").trim();
  if (!requestedPath) {
    throw new Error("path is required");
  }
  const absPath = resolveAllowedReadPath(context, requestedPath);
  const relPath = toRelPath(context.workspace_path, absPath);
  const exists = await fs
    .access(absPath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    return { path: relPath, text: "", missing: true };
  }
  const content = String(await fs.readFile(absPath, "utf-8"));
  const from = payload.from ? Math.max(1, Math.floor(payload.from)) : undefined;
  const lines = payload.lines ? Math.max(1, Math.floor(payload.lines)) : undefined;
  if (!from && !lines) {
    return { path: relPath, text: content };
  }
  const rows = content.split("\n");
  const start = from ?? 1;
  const size = lines ?? rows.length;
  const slice = rows.slice(start - 1, start - 1 + size).join("\n");
  return { path: relPath, text: slice };
}

/**
 * 读取 wiki index 内容。
 */
export async function readWikiIndex(context: PluginContext): Promise<string> {
  const indexPath = path.join(context.workspace_path, ".downcity", "memory", "wiki", "index.md");
  return await readTextIfExists(indexPath);
}

/**
 * 归档手动 source。
 */
export async function appendManualSource(
  context: PluginContext,
  content: string,
  source?: string,
): Promise<{ path: string; writtenChars: number }> {
  const absPath = path.join(
    context.workspace_path,
    ".downcity",
    "memory",
    "sources",
    "manual",
    `${dateStamp()}.md`,
  );
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const entry = buildSourceEntry(content, source);
  await fs.appendFile(absPath, `\n${entry}`, "utf-8");
  return {
    path: toRelPath(context.workspace_path, absPath),
    writtenChars: entry.length,
  };
}

/**
 * 写入 session source。
 */
export async function writeSessionSource(
  context: PluginContext,
  session_id: string,
  content: string,
): Promise<{ path: string; writtenChars: number }> {
  const safeSessionId = slugify(session_id);
  const absPath = path.join(
    context.workspace_path,
    ".downcity",
    "memory",
    "sources",
    "sessions",
    `${safeSessionId}.md`,
  );
  const text = [
    "---",
    `title: ${JSON.stringify(`Session ${session_id}`)}`,
    `date: ${dateStamp()}`,
    'tags: ["memory-source", "session"]',
    "---",
    "",
    `# Session ${session_id}`,
    "",
    content.trim(),
    "",
  ].join("\n");
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, text, "utf-8");
  return {
    path: toRelPath(context.workspace_path, absPath),
    writtenChars: text.length,
  };
}

/**
 * 写入完整 wiki page。
 */
export async function writeWikiPage(
  context: PluginContext,
  draft: MemoryWikiPageDraft,
): Promise<{ path: string; writtenChars: number }> {
  const resolved = resolveWikiPath(context, draft.path, draft.title);
  const content = ensureFrontmatter(draft);
  await fs.mkdir(path.dirname(resolved.absPath), { recursive: true });
  await fs.writeFile(resolved.absPath, content, "utf-8");
  return {
    path: resolved.relPath,
    writtenChars: content.length,
  };
}

/**
 * 追加写入 wiki page。
 */
export async function appendWikiPage(
  context: PluginContext,
  payload: {
    path?: string;
    title?: string;
    content: string;
    sourcePath?: string;
    instruction?: string;
  },
): Promise<{ path: string; writtenChars: number }> {
  const resolved = resolveWikiPath(context, payload.path, payload.title);
  await fs.mkdir(path.dirname(resolved.absPath), { recursive: true });
  const exists = await fs
    .access(resolved.absPath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    await writeWikiPage(context, {
      path: resolved.relPath,
      title: payload.title || "Memory Inbox",
      content: "This page is maintained by MemoryPlugin fallback writes.",
      tags: ["memory"],
    });
  }
  const entry = buildFallbackWikiEntry(payload);
  await fs.appendFile(resolved.absPath, `\n${entry}`, "utf-8");
  return {
    path: resolved.relPath,
    writtenChars: entry.length,
  };
}

/**
 * 使用 fallback 方式修订 wiki page。
 */
export async function appendMemoryRevision(
  context: PluginContext,
  payload: MemoryRevisePayload,
): Promise<MemoryReviseResponse> {
  const written = await appendWikiPage(context, {
    path: payload.path,
    content: String(payload.evidence || "").trim() || "(no evidence)",
    instruction: payload.instruction,
  });
  return {
    path: written.path,
    mode: "appended",
    writtenChars: written.writtenChars,
  };
}
