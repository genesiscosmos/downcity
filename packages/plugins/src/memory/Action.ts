/**
 * Memory Plugin action 逻辑。
 *
 * 关键点（中文）
 * - action 面向 agent 的记忆语义：search/read/remember/digest/revise。
 * - 原始证据先进入 sources，长期知识进入 wiki。
 * - LLM digest/revise 能力由 MemoryPlugin constructor 注入。
 */

import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import { isTextUIPart } from "ai";
import type { PluginActionResult } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
import type { JsonValue } from "@downcity/agent";
import type { SessionMessage } from "@downcity/agent";
import type {
  MemoryDigestPayload,
  MemoryDigestResponse,
  MemoryPluginOptions,
  MemoryReadPayload,
  MemoryRememberPayload,
  MemoryRememberResponse,
  MemoryRevisePayload,
  MemoryReviseResponse,
  MemorySearchPayload,
} from "@/memory/types/Memory.js";
import {
  collectMemoryStatus,
  searchMemory,
} from "./runtime/Search.js";
import {
  MEMORY_DEFAULTS,
  type MemoryRuntimeState,
} from "./runtime/Store.js";
import {
  appendManualSource,
  appendMemoryRevision,
  appendWikiPage,
  readMemory,
  readWikiIndex,
  writeSessionSource,
  writeWikiPage,
} from "./runtime/Writer.js";

type AnyUiMessagePart = UIMessagePart<UIDataTypes, UITools>;

function toUiParts(message: unknown): AnyUiMessagePart[] {
  const candidate = message as { parts?: unknown } | null | undefined;
  return Array.isArray(candidate?.parts)
    ? (candidate.parts as AnyUiMessagePart[])
    : [];
}

function extractReadableLine(message: unknown): string {
  const candidate = message as { role?: unknown } | null | undefined;
  const raw_role = String(candidate?.role || "").toLowerCase();
  if (raw_role !== "user" && raw_role !== "assistant") return "";
  const role = raw_role === "user" ? "User" : "Assistant";
  const text = toUiParts(message)
    .filter(isTextUIPart)
    .map((part) => String(part.text || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text) {
    return "";
  }
  return `${role}: ${text}`;
}

/** 从 canonical Session Message 提取 Memory digest 文本。 */
function extract_session_message_line(message: SessionMessage): string {
  if (message.type !== "user" && message.type !== "assistant") return "";
  const role = message.type === "user" ? "User" : "Assistant";
  const text = message.parts
    .flatMap((part) =>
      part.type === "text" ? [String(part.text || "").trim()] : [],
    )
    .filter(Boolean)
    .join("\n")
    .trim();
  return text ? `${role}: ${text}` : "";
}

function readDigestPages(result: Awaited<ReturnType<NonNullable<MemoryPluginOptions["digest"]>>>): {
  pages: Array<{ path?: string; title?: string; content: string; tags?: string[] }>;
  summary?: string;
} {
  if (typeof result === "string") {
    return {
      pages: [{ title: "Memory Digest", content: result, tags: ["memory", "digest"] }],
    };
  }
  return {
    pages: result.pages,
    summary: result.summary,
  };
}

function readReviseResult(
  result: Awaited<ReturnType<NonNullable<MemoryPluginOptions["revise"]>>>,
  fallbackPath: string,
): { path: string; content: string; summary?: string } {
  if (typeof result === "string") {
    return {
      path: fallbackPath,
      content: result,
    };
  }
  return {
    path: result.path || fallbackPath,
    content: result.content,
    summary: result.summary,
  };
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

function toWikiMemoryPath(value: string): string {
  const clean = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!clean) return ".downcity/memory/wiki/inbox.md";
  if (clean.startsWith(".downcity/memory/wiki/")) {
    return clean.toLowerCase().endsWith(".md") ? clean : `${clean}.md`;
  }
  const withoutPrefix = clean.replace(/^wiki\//, "");
  const withExt = withoutPrefix.toLowerCase().endsWith(".md")
    ? withoutPrefix
    : `${withoutPrefix}.md`;
  return `.downcity/memory/wiki/${withExt}`;
}

/**
 * status action。
 */
export async function statusMemoryAction(
  context: PluginContext,
  state: MemoryRuntimeState,
): Promise<PluginActionResult<JsonValue>> {
  try {
    const stats = await collectMemoryStatus(context, state);
    return {
      success: true,
      data: stats as unknown as JsonValue,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * search action。
 */
export async function searchMemoryAction(
  context: PluginContext,
  state: MemoryRuntimeState,
  payload: MemorySearchPayload,
): Promise<PluginActionResult<JsonValue>> {
  try {
    const response = await searchMemory(context, state, payload);
    return {
      success: true,
      data: response as unknown as JsonValue,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * read action。
 */
export async function readMemoryAction(
  context: PluginContext,
  payload: MemoryReadPayload,
): Promise<PluginActionResult<JsonValue>> {
  try {
    const data = await readMemory(context, payload);
    return { success: true, data: data as unknown as JsonValue };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * remember action。
 */
export async function rememberMemoryAction(
  context: PluginContext,
  options: MemoryPluginOptions,
  payload: MemoryRememberPayload,
): Promise<PluginActionResult<JsonValue>> {
  try {
    const content = String(payload.content || "").trim();
    if (!content) {
      throw new Error("content is required");
    }
    const source = await appendManualSource(context, content, payload.source);
    const targetPath = toWikiMemoryPath(payload.path || slugify(payload.topic || "inbox"));

    if (options.revise) {
      const current = await readMemory(context, { path: targetPath }).catch(() => ({
        path: targetPath,
        text: "",
      }));
      const revised = readReviseResult(
        await options.revise({
          rootPath: context.workspace_path,
          path: targetPath,
          currentContent: current.text,
          instruction: "Integrate this new memory into the wiki page. Deduplicate and keep it concise.",
          evidence: `${content}\n\nSource: ${source.path}`,
        }),
        targetPath,
      );
      const written = await writeWikiPage(context, {
        path: revised.path,
        title: payload.topic,
        content: revised.content,
        tags: ["memory"],
      });
      const response: MemoryRememberResponse = {
        sourcePath: source.path,
        wikiPath: written.path,
        mode: "revised",
        writtenChars: written.writtenChars,
        summary: revised.summary,
      };
      return { success: true, data: response as unknown as JsonValue };
    }

    const written = await appendWikiPage(context, {
      path: targetPath,
      title: payload.topic || "Memory Inbox",
      content,
      sourcePath: source.path,
    });
    const response: MemoryRememberResponse = {
      sourcePath: source.path,
      wikiPath: written.path,
      mode: "appended",
      writtenChars: written.writtenChars,
    };
    return { success: true, data: response as unknown as JsonValue };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * digest action。
 */
export async function digestMemoryAction(
  context: PluginContext,
  options: MemoryPluginOptions,
  payload: MemoryDigestPayload,
): Promise<PluginActionResult<JsonValue>> {
  try {
    const session_id = String(payload.session_id || "").trim();
    if (!session_id) {
      throw new Error("session_id is required");
    }
    const maxMessages = Number.isFinite(payload.maxMessages)
      ? Math.max(1, Math.floor(payload.maxMessages as number))
      : 30;
    const snapshot = await context.sessions.runtime(session_id).context();
    const total = snapshot.messages.length;
    const start = Math.max(0, total - maxMessages);
    const messages = snapshot.messages.slice(start);
    const lines = messages
      .map((message) => extract_session_message_line(message))
      .filter((line) => line.length > 0);
    const transcript =
      lines.length > 0
        ? lines.join("\n\n")
        : "本次 digest 未找到可写入的用户/助手文本内容。";
    const sourceText = [
      `Window: ${start}-${Math.max(start, total - 1)}`,
      "",
      transcript,
    ].join("\n");
    const source = await writeSessionSource(context, session_id, sourceText);

    if (options.digest) {
      const wikiIndex = await readWikiIndex(context);
      const digested = readDigestPages(
        await options.digest({
          rootPath: context.workspace_path,
          sourceText,
          sourcePath: source.path,
          session_id,
          wikiIndex,
        }),
      );
      const wikiPaths: string[] = [];
      for (const page of digested.pages) {
        const written = await writeWikiPage(context, page);
        wikiPaths.push(written.path);
      }
      const response: MemoryDigestResponse = {
        sourcePath: source.path,
        wikiPaths,
        message_count: lines.length,
        mode: "digested",
        summary: digested.summary,
      };
      return { success: true, data: response as unknown as JsonValue };
    }

    const written = await appendWikiPage(context, {
      path: "session-digests",
      title: "Session Digests",
      content: sourceText,
      sourcePath: source.path,
    });
    const response: MemoryDigestResponse = {
      sourcePath: source.path,
      wikiPaths: [written.path],
      message_count: lines.length,
      mode: "archived",
    };
    return { success: true, data: response as unknown as JsonValue };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * revise action。
 */
export async function reviseMemoryAction(
  context: PluginContext,
  options: MemoryPluginOptions,
  payload: MemoryRevisePayload,
): Promise<PluginActionResult<JsonValue>> {
  try {
    const targetPath = toWikiMemoryPath(String(payload.path || "").trim());
    if (!targetPath) {
      throw new Error("path is required");
    }
    const instruction = String(payload.instruction || "").trim();
    if (!instruction) {
      throw new Error("instruction is required");
    }

    if (options.revise) {
      const current = await readMemory(context, { path: targetPath }).catch(() => ({
        path: targetPath,
        text: "",
      }));
      const revised = readReviseResult(
        await options.revise({
          rootPath: context.workspace_path,
          path: targetPath,
          currentContent: current.text,
          instruction,
          evidence: String(payload.evidence || ""),
        }),
        targetPath,
      );
      const written = await writeWikiPage(context, {
        path: revised.path,
        content: revised.content,
        tags: ["memory"],
      });
      const response: MemoryReviseResponse = {
        path: written.path,
        mode: "revised",
        writtenChars: written.writtenChars,
        summary: revised.summary,
      };
      return { success: true, data: response as unknown as JsonValue };
    }

    const response = await appendMemoryRevision(context, payload);
    return { success: true, data: response as unknown as JsonValue };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * 把任意 payload 归一化为 search payload。
 */
export function toSearchPayload(input: Record<string, unknown>): MemorySearchPayload {
  return {
    query: String(input.query || ""),
    maxResults:
      typeof input.maxResults === "number"
        ? input.maxResults
        : typeof input.maxResults === "string"
          ? Number(input.maxResults)
          : MEMORY_DEFAULTS.maxResults,
    minScore:
      typeof input.minScore === "number"
        ? input.minScore
        : typeof input.minScore === "string"
          ? Number(input.minScore)
          : MEMORY_DEFAULTS.minScore,
    includeSources:
      typeof input.includeSources === "boolean"
        ? input.includeSources
        : typeof input.includeSources === "string"
          ? input.includeSources === "true"
          : undefined,
  };
}
