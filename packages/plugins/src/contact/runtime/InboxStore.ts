/**
 * contact inbox 存储。
 *
 * 关键点（中文）
 * - 每条 share 都是独立目录，避免大内容堆进单个 JSON。
 * - `inbox` 列表只读取 `meta.json`，保持轻量。
 */

import fs from "fs-extra";
import path from "node:path";
import type {
  ContactInboxShareMeta,
  ContactInboxSharePayload,
  SaveContactInboxShareInput,
} from "@/contact/types/ContactShare.js";
import {
  getContactInboxRootPath,
  getContactInboxShareFilesPath,
  getContactInboxShareMetaPath,
  getContactInboxSharePath,
  getContactInboxSharePayloadPath,
  getContactReceivedSharePath,
} from "./Paths.js";

function assertSafeRelativePath(relativePath: string): string {
  const value = String(relativePath || "").trim();
  if (!value) throw new Error("relativePath is required");
  if (path.isAbsolute(value)) throw new Error(`Absolute path is not allowed: ${value}`);
  const normalized = path.normalize(value);
  if (
    normalized === "." ||
    normalized.startsWith("..") ||
    normalized.includes(`${path.sep}..${path.sep}`) ||
    normalized.endsWith(`${path.sep}..`)
  ) {
    throw new Error(`Unsafe relative path: ${value}`);
  }
  return normalized;
}

function isMeta(input: unknown): input is ContactInboxShareMeta {
  const item = input as Partial<ContactInboxShareMeta> | null;
  return Boolean(
    item &&
      typeof item.id === "string" &&
      typeof item.fromAgentName === "string" &&
      (item.status === "pending" || item.status === "received"),
  );
}

/**
 * 保存 inbox share。
 */
export async function saveContactInboxShare(
  project_root: string,
  input: SaveContactInboxShareInput,
): Promise<ContactInboxShareMeta> {
  const inboxRoot = getContactInboxRootPath(project_root);
  const sharePath = getContactInboxSharePath(project_root, input.meta.id);
  const tempRoot = path.join(path.dirname(inboxRoot), ".inbox-tmp");
  const tempPath = path.join(
    tempRoot,
    `${path.basename(sharePath)}.${process.pid}.${Date.now()}`,
  );

  await fs.ensureDir(inboxRoot);
  await fs.remove(tempPath);
  try {
    await fs.ensureDir(tempPath);
    await fs.writeJson(path.join(tempPath, "payload.json"), input.payload, {
      spaces: 2,
    });

    const filesRoot = path.join(tempPath, "files");
    for (const file of input.files) {
      const relativePath = assertSafeRelativePath(file.relativePath);
      const outputPath = path.join(filesRoot, relativePath);
      const encoding = file.encoding === "base64" ? "base64" : "utf8";
      const content =
        encoding === "base64"
          ? Buffer.from(file.content, "base64")
          : Buffer.from(file.content, "utf-8");
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, content);
    }

    // meta 最后写入，正式目录只在整条 share 完整后出现，避免 inbox 暴露半成品。
    await fs.writeJson(path.join(tempPath, "meta.json"), input.meta, {
      spaces: 2,
    });
    await fs.move(tempPath, sharePath, {
      overwrite: false,
    });
  } catch (error) {
    await fs.remove(tempPath).catch(() => undefined);
    throw error;
  }

  return input.meta;
}

/**
 * 读取 inbox share meta。
 */
export async function readContactInboxShareMeta(
  project_root: string,
  shareId: string,
): Promise<ContactInboxShareMeta | null> {
  const filePath = getContactInboxShareMetaPath(project_root, shareId);
  if (!(await fs.pathExists(filePath))) return null;
  const raw = await fs.readJson(filePath).catch(() => null);
  return isMeta(raw) ? raw : null;
}

/**
 * 读取 inbox share payload。
 */
export async function readContactInboxSharePayload(
  project_root: string,
  shareId: string,
): Promise<ContactInboxSharePayload | null> {
  const filePath = getContactInboxSharePayloadPath(project_root, shareId);
  if (!(await fs.pathExists(filePath))) return null;
  const raw = await fs.readJson(filePath).catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const payload = raw as ContactInboxSharePayload;
  return payload.kind === "share" ? payload : null;
}

/**
 * 列出 inbox share。
 */
export async function listContactInboxShares(
  project_root: string,
): Promise<ContactInboxShareMeta[]> {
  const root = getContactInboxRootPath(project_root);
  if (!(await fs.pathExists(root))) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const shares: ContactInboxShareMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readContactInboxShareMeta(project_root, entry.name);
    if (meta) shares.push(meta);
  }
  return shares.sort((a, b) => b.receivedAt - a.receivedAt);
}

/**
 * 标记 share 已接收，并复制轻量状态到 received。
 */
export async function markContactInboxShareReceived(
  project_root: string,
  shareId: string,
): Promise<ContactInboxShareMeta> {
  const meta = await readContactInboxShareMeta(project_root, shareId);
  if (!meta) throw new Error(`Share not found: ${shareId}`);
  const next: ContactInboxShareMeta = {
    ...meta,
    status: "received",
  };
  const receivedPath = getContactReceivedSharePath(project_root, shareId);
  await fs.ensureDir(receivedPath);
  await fs.writeJson(path.join(receivedPath, "meta.json"), next, {
    spaces: 2,
  });
  // received 区先完整写入，最后再更新 inbox meta，避免列表状态提前变成 received。
  await fs.writeJson(getContactInboxShareMetaPath(project_root, shareId), next, {
    spaces: 2,
  });
  return next;
}

/**
 * 读取 share 文件根目录。
 */
export function getInboxShareFilesRoot(project_root: string, shareId: string): string {
  return getContactInboxShareFilesPath(project_root, shareId);
}
