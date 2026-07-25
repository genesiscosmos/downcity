/**
 * contact 通用 share 打包与接收。
 *
 * 关键点（中文）
 * - share 不理解 skill，只处理文本、链接、文件和目录。
 * - receive 不自动安装或执行内容，只把 share 标记为已接收并复制到 received 区。
 */

import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import type { PluginContext } from "@downcity/agent";
import type {
  ContactInboxShareFileInput,
  ContactInboxShareMeta,
  ContactReceiveShareRequest,
  ContactShareFileManifest,
  ContactShareItem,
  ContactSharePayload,
  SaveContactInboxShareInput,
} from "@/contact/types/ContactShare.js";
import { createContactId } from "./Token.js";
import {
  getInboxShareFilesRoot,
  markContactInboxShareReceived,
  readContactInboxSharePayload,
} from "./InboxStore.js";
import { getContactReceivedSharePath } from "./Paths.js";

function hashContent(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function assertSafeRelativePath(relativePath: string): string {
  const value = String(relativePath || "").trim();
  if (!value) throw new Error("relativePath is required");
  if (path.isAbsolute(value)) throw new Error(`Absolute path is not allowed: ${value}`);
  const normalized = path.normalize(value);
  if (normalized.startsWith("..") || normalized.includes(`${path.sep}..${path.sep}`)) {
    throw new Error(`Unsafe relative path: ${value}`);
  }
  return normalized;
}

function createItemRoot(itemPath: string): string {
  const base = path.basename(itemPath).replace(/[^a-zA-Z0-9._-]+/g, "_") || "item";
  return `${createContactId("item")}_${base}`;
}

async function collectPathFiles(params: {
  /**
   * 要分享的文件或目录。
   */
  sourcePath: string;
  /**
   * share files 下的 item 根目录。
   */
  itemRoot: string;
}): Promise<{
  /**
   * share 附带文件内容。
   */
  files: ContactInboxShareFileInput[];
  /**
   * item manifest 文件列表。
   */
  manifest: ContactShareFileManifest[];
  /**
   * item 类型。
   */
  itemType: "file" | "directory";
}> {
  const stat = await fs.stat(params.sourcePath);
  const files: ContactInboxShareFileInput[] = [];
  const manifest: ContactShareFileManifest[] = [];

  const pushFile = async (absPath: string, relativePath: string): Promise<void> => {
    const safeRelative = assertSafeRelativePath(relativePath);
    const content = await fs.readFile(absPath);
    files.push({
      relativePath: path.join(params.itemRoot, safeRelative),
      content: content.toString("base64"),
      encoding: "base64",
    });
    manifest.push({
      path: safeRelative,
      sha256: hashContent(content),
    });
  };

  if (stat.isFile()) {
    await pushFile(params.sourcePath, path.basename(params.sourcePath));
    return { files, manifest, itemType: "file" };
  }

  if (!stat.isDirectory()) {
    throw new Error(`Only files and directories can be shared: ${params.sourcePath}`);
  }

  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      await pushFile(absPath, path.relative(params.sourcePath, absPath));
    }
  };
  await walk(params.sourcePath);
  return { files, manifest, itemType: "directory" };
}

function normalizeLinks(input: string[] | undefined): string[] {
  const values = Array.isArray(input) ? input : [];
  return values
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

/**
 * 创建通用 share。
 */
export async function createShareInput(params: {
  /**
   * 当前 agent context。
   */
  context: PluginContext;
  /**
   * 发送方 contact id。
   */
  fromContactId: string;
  /**
   * 发送方 agent 名称。
   */
  fromAgentName: string;
  /**
   * 分享文本。
   */
  text?: string;
  /**
   * 分享链接。
   */
  links?: string[];
  /**
   * 分享文件或目录路径。
   */
  paths?: string[];
}): Promise<SaveContactInboxShareInput> {
  const items: ContactShareItem[] = [];
  const files: ContactInboxShareFileInput[] = [];

  const text = String(params.text || "").trim();
  if (text) {
    items.push({
      id: createContactId("item"),
      type: "text",
      title: "Text",
      text,
    });
  }

  for (const link of normalizeLinks(params.links)) {
    items.push({
      id: createContactId("item"),
      type: "link",
      title: link,
      url: link,
    });
  }

  for (const rawPath of Array.isArray(params.paths) ? params.paths : []) {
    const sourcePath = path.resolve(params.context.workspace_path, String(rawPath || "").trim());
    const itemRoot = createItemRoot(sourcePath);
    const collected = await collectPathFiles({
      sourcePath,
      itemRoot,
    });
    files.push(...collected.files);
    items.push({
      id: createContactId("item"),
      type: collected.itemType,
      title: path.basename(sourcePath),
      root: itemRoot,
      files: collected.manifest,
    });
  }

  if (items.length === 0) {
    throw new Error("Share requires at least one text, link, file, or directory item");
  }

  const sizeBytes =
    files.reduce((sum, file) => {
      if (file.encoding === "base64") return sum + Buffer.byteLength(file.content, "base64");
      return sum + Buffer.byteLength(file.content, "utf-8");
    }, 0) +
    Buffer.byteLength(text, "utf-8") +
    normalizeLinks(params.links).reduce(
      (sum, link) => sum + Buffer.byteLength(link, "utf-8"),
      0,
    );
  const title = items
    .slice(0, 3)
    .map((item) => item.title)
    .join(", ");
  const meta: ContactInboxShareMeta = {
    id: createContactId("share"),
    fromContactId: params.fromContactId,
    fromAgentName: params.fromAgentName,
    title: title || "Share",
    status: "pending",
    receivedAt: Date.now(),
    sizeBytes,
    itemCount: items.length,
  };
  const payload: ContactSharePayload = {
    kind: "share",
    items,
  };

  return {
    meta,
    payload,
    files,
  };
}

/**
 * 接收通用 share。
 */
export async function receiveShare(params: {
  /**
   * 项目根目录。
   */
  project_root: string;
  /**
   * share id。
   */
  shareId: string;
}): Promise<{
  /**
   * 接收后的 item 数量。
   */
  itemCount: number;
  /**
   * received 目录。
   */
  receivedPath: string;
}> {
  const payload = await readContactInboxSharePayload(params.project_root, params.shareId);
  if (!payload) throw new Error(`Share payload not found: ${params.shareId}`);
  if (payload.kind !== "share") throw new Error(`Unsupported share payload: ${payload.kind}`);

  const receivedPath = getContactReceivedSharePath(params.project_root, params.shareId);
  await fs.ensureDir(receivedPath);
  await fs.writeJson(path.join(receivedPath, "payload.json"), payload, { spaces: 2 });

  const filesRoot = getInboxShareFilesRoot(params.project_root, params.shareId);
  if (await fs.pathExists(filesRoot)) {
    await fs.copy(filesRoot, path.join(receivedPath, "files"), {
      overwrite: true,
    });
  }

  await markContactInboxShareReceived(params.project_root, params.shareId);
  return {
    itemCount: payload.items.length,
    receivedPath,
  };
}

/**
 * 构造远端 receive share 请求。
 */
export function createReceiveShareRequest(
  input: SaveContactInboxShareInput,
  senderContactId: string,
): ContactReceiveShareRequest {
  return {
    ...input,
    senderContactId,
  };
}
