/**
 * Memory Store（文件枚举与轻量运行态）。
 *
 * 关键点（中文）
 * - MemoryPlugin 使用 LLM Wiki 结构：`wiki/` 是知识层，`sources/` 是证据层。
 * - 当前实现不维护后台索引，扫描 Markdown 即可工作。
 * - 运行态只保存 rootPath，避免伪装成有后台 worker 的复杂 runtime。
 */

import type { Dirent } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { PluginContext } from "@downcity/agent";
import type {
  MemoryDefaults,
  MemorySourceType,
} from "@/memory/types/Memory.js";

export const MEMORY_DEFAULTS: MemoryDefaults = {
  maxResults: 6,
  minScore: 0.35,
  maxInjectedChars: 4000,
};

export type MemorySourceFile = {
  /**
   * 来源分类。
   */
  source: MemorySourceType;

  /**
   * 绝对路径。
   */
  absPath: string;

  /**
   * 相对项目根目录路径。
   */
  relPath: string;
};

export type MemoryRuntimeState = {
  /**
   * 项目根目录。
   */
  rootPath: string;
};

function normalizeRelPath(rootPath: string, absPath: string): string {
  return path.relative(rootPath, absPath).replace(/\\/g, "/");
}

function isMarkdownPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".md");
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fsp.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function listMarkdownFilesRecursively(dirPath: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[] = [];
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      out.push(...(await listMarkdownFilesRecursively(abs)));
      continue;
    }
    if (!entry.isFile() || !isMarkdownPath(abs)) {
      continue;
    }
    out.push(abs);
  }
  return out;
}

async function pushMarkdownTree(
  out: MemorySourceFile[],
  rootPath: string,
  dirPath: string,
  source: MemorySourceType,
): Promise<void> {
  for (const absPath of await listMarkdownFilesRecursively(dirPath)) {
    out.push({
      source,
      absPath,
      relPath: normalizeRelPath(rootPath, absPath),
    });
  }
}

/**
 * 枚举 memory Markdown 文件。
 */
export async function listMemorySourceFiles(
  rootPath: string,
  options: { includeSources?: boolean } = {},
): Promise<MemorySourceFile[]> {
  const out: MemorySourceFile[] = [];
  await pushMarkdownTree(
    out,
    rootPath,
    path.join(rootPath, ".downcity", "memory", "wiki"),
    "wiki",
  );

  if (options.includeSources) {
    await pushMarkdownTree(
      out,
      rootPath,
      path.join(rootPath, ".downcity", "memory", "sources"),
      "source",
    );

    // 旧版 daily / MEMORY.md 被当作 source 层读取，避免已有文件突然不可检索。
    const longterm = path.join(rootPath, ".downcity", "memory", "MEMORY.md");
    if (await pathExists(longterm)) {
      out.push({
        source: "source",
        absPath: longterm,
        relPath: normalizeRelPath(rootPath, longterm),
      });
    }
    await pushMarkdownTree(
      out,
      rootPath,
      path.join(rootPath, ".downcity", "memory", "daily"),
      "source",
    );
  }

  return out;
}

/**
 * 创建一个新的 memory plugin state。
 */
export function createMemoryRuntimeState(
  context: PluginContext,
): MemoryRuntimeState {
  return {
    rootPath: context.workspace_path,
  };
}
