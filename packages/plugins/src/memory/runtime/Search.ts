/**
 * Memory Search 运行时。
 *
 * 关键点（中文）
 * - 直接扫描 LLM Wiki Markdown 文件，不依赖额外索引库。
 * - 统一收敛检索、分块、打分与状态统计逻辑。
 */

import fs from "node:fs/promises";
import type { PluginContext } from "@downcity/agent";
import type {
  MemorySearchPayload,
  MemorySearchResponse,
  MemorySearchResultItem,
  MemorySourceStat,
  MemoryStatusResponse,
} from "@/memory/types/Memory.js";
import {
  listMemorySourceFiles,
  MEMORY_DEFAULTS,
  type MemoryRuntimeState,
} from "./Store.js";

const SNIPPET_MAX_CHARS = 700;
const CHUNK_MAX_CHARS = 1600;
const CHUNK_OVERLAP_CHARS = 240;

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeText(input: string): string {
  return String(input || "").replace(/\r\n/g, "\n");
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars);
}

function tokenizeQuery(raw: string): string[] {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function countTokenOccurrences(text: string, token: string): number {
  if (!token) return 0;
  let hits = 0;
  let start = 0;
  while (start < text.length) {
    const index = text.indexOf(token, start);
    if (index < 0) break;
    hits += 1;
    start = index + token.length;
  }
  return hits;
}

function buildSnippetScore(text: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const normalized = normalizeText(text).toLowerCase();
  let matchedTokens = 0;
  let totalHits = 0;
  for (const token of tokens) {
    const hits = countTokenOccurrences(normalized, token);
    if (hits > 0) {
      matchedTokens += 1;
      totalHits += Math.min(hits, 4);
    }
  }
  if (matchedTokens === 0) {
    return 0;
  }
  const coverageScore = matchedTokens / tokens.length;
  const densityScore = Math.min(totalHits, tokens.length * 3) / (tokens.length * 3);
  return Number((coverageScore * 0.75 + densityScore * 0.25).toFixed(4));
}

function chunkMarkdown(content: string): Array<{
  startLine: number;
  endLine: number;
  text: string;
}> {
  const lines = normalizeText(content).split("\n");
  if (lines.length === 0) {
    return [];
  }
  const out: Array<{
    startLine: number;
    endLine: number;
    text: string;
  }> = [];
  let bucket: Array<{ line: string; lineNo: number }> = [];
  let chars = 0;

  const flush = () => {
    if (bucket.length === 0) return;
    const startLine = bucket[0]?.lineNo ?? 1;
    const endLine = bucket[bucket.length - 1]?.lineNo ?? startLine;
    const text = bucket.map((item) => item.line).join("\n").trim();
    if (!text) return;
    out.push({
      startLine,
      endLine,
      text,
    });
  };

  const carryOverlap = () => {
    if (bucket.length === 0 || CHUNK_OVERLAP_CHARS <= 0) {
      bucket = [];
      chars = 0;
      return;
    }
    let acc = 0;
    const next: Array<{ line: string; lineNo: number }> = [];
    for (let i = bucket.length - 1; i >= 0; i -= 1) {
      const row = bucket[i];
      if (!row) continue;
      acc += row.line.length + 1;
      next.unshift(row);
      if (acc >= CHUNK_OVERLAP_CHARS) break;
    }
    bucket = next;
    chars = bucket.reduce((sum, item) => sum + item.line.length + 1, 0);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const rowSize = line.length + 1;
    if (bucket.length > 0 && chars + rowSize > CHUNK_MAX_CHARS) {
      flush();
      carryOverlap();
    }
    bucket.push({ line, lineNo: i + 1 });
    chars += rowSize;
  }
  flush();
  return out;
}

async function readMemoryChunks(
  context: PluginContext,
  options: { includeSources?: boolean },
): Promise<Array<{
  path: string;
  source: "wiki" | "source" | "working";
  startLine: number;
  endLine: number;
  text: string;
}>> {
  const files = await listMemorySourceFiles(context.workspace_path, options);
  const out: Array<{
    path: string;
    source: "wiki" | "source" | "working";
    startLine: number;
    endLine: number;
    text: string;
  }> = [];
  for (const file of files) {
    const content = String(await fs.readFile(file.absPath, "utf-8"));
    for (const chunk of chunkMarkdown(content)) {
      out.push({
        path: file.relPath,
        source: file.source,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
      });
    }
  }
  return out;
}

/**
 * 收集当前 memory Markdown 状态。
 */
export async function collectMemoryStatus(
  context: PluginContext,
  state: MemoryRuntimeState,
): Promise<MemoryStatusResponse> {
  void state;
  const files = await listMemorySourceFiles(context.workspace_path, {
    includeSources: true,
  });
  const sourceCounts: MemorySourceStat[] = [
    { source: "wiki", files: 0, chunks: 0 },
    { source: "source", files: 0, chunks: 0 },
    { source: "working", files: 0, chunks: 0 },
  ];

  let totalChunks = 0;
  for (const file of files) {
    const bucket = sourceCounts.find((item) => item.source === file.source);
    if (bucket) {
      bucket.files += 1;
    }
    const content = String(await fs.readFile(file.absPath, "utf-8"));
    const chunks = chunkMarkdown(content).length;
    totalChunks += chunks;
    if (bucket) {
      bucket.chunks += chunks;
    }
  }

  return {
    backend: "builtin",
    mode: "scan",
    files: files.length,
    chunks: totalChunks,
    sourceCounts,
  };
}

/**
 * 执行检索。
 */
export async function searchMemory(
  context: PluginContext,
  state: MemoryRuntimeState,
  payload: MemorySearchPayload,
): Promise<MemorySearchResponse> {
  void state;

  const query = String(payload.query || "").trim();
  if (!query) {
    return {
      backend: "builtin",
      mode: "scan",
      results: [],
    };
  }

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return {
      backend: "builtin",
      mode: "scan",
      results: [],
    };
  }

  const maxResults = Math.floor(
    clampNumber(
      Number(payload.maxResults ?? MEMORY_DEFAULTS.maxResults),
      1,
      20,
    ),
  );
  const minScore = clampNumber(
    Number(payload.minScore ?? MEMORY_DEFAULTS.minScore),
    0,
    1,
  );

  try {
    const results = (await readMemoryChunks(context, {
      includeSources: payload.includeSources,
    }))
      .map((chunk) => {
        const score = buildSnippetScore(chunk.text, tokens);
        const citation =
          chunk.startLine === chunk.endLine
            ? `${chunk.path}#L${chunk.startLine}`
            : `${chunk.path}#L${chunk.startLine}-L${chunk.endLine}`;
        return {
          path: chunk.path,
          source: chunk.source,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score,
          snippet: truncateText(chunk.text, SNIPPET_MAX_CHARS),
          citation,
        } satisfies MemorySearchResultItem;
      })
      .filter((item) => item.score >= minScore)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (left.path !== right.path) {
          return left.path.localeCompare(right.path);
        }
        return left.startLine - right.startLine;
      })
      .slice(0, maxResults * 3);

    let remain = Math.max(0, MEMORY_DEFAULTS.maxInjectedChars);
    const clamped: MemorySearchResultItem[] = [];
    for (const item of results) {
      if (remain <= 0 || clamped.length >= maxResults) break;
      if (item.snippet.length <= remain) {
        clamped.push(item);
        remain -= item.snippet.length;
        continue;
      }
      clamped.push({
        ...item,
        snippet: item.snippet.slice(0, remain),
      });
      break;
    }

    return {
      backend: "builtin",
      mode: "scan",
      results: clamped,
    };
  } catch (error) {
    const message = String(error);
    return {
      backend: "builtin",
      mode: "scan",
      results: [],
      error: message,
      action: "Check the Markdown memory files under `.downcity/memory/`.",
    };
  }
}
