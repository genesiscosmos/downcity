/**
 * contact link code 编码。
 *
 * 关键点（中文）
 * - link code 是 `dc-link-v1.<base64url-json>`。
 * - 这里只负责编码/解析，不负责落盘状态校验。
 */

import type { ContactLinkCodePayload } from "@/contact/types/ContactLink.js";

const CONTACT_LINK_PREFIX = "dc-link-v1.";

function encodeJson(input: ContactLinkCodePayload): string {
  return Buffer.from(JSON.stringify(input), "utf-8").toString("base64url");
}

function decodeJson(input: string): ContactLinkCodePayload {
  const text = Buffer.from(input, "base64url").toString("utf-8");
  const parsed = JSON.parse(text) as Partial<ContactLinkCodePayload>;
  if (parsed.version !== 1) throw new Error("Unsupported contact link version");
  const linkId = String(parsed.linkId || "").trim();
  const agentName = String(parsed.agentName || "").trim();
  const endpoint = String(parsed.endpoint || "").trim();
  const secret = String(parsed.secret || "").trim();
  const created_at = Number(parsed.created_at);
  const expires_at = Number(parsed.expires_at);
  if (!linkId || !agentName || !endpoint || !secret) {
    throw new Error("Invalid contact link code");
  }
  if (!Number.isFinite(created_at) || !Number.isFinite(expires_at)) {
    throw new Error("Invalid contact link timestamps");
  }
  return {
    version: 1,
    linkId,
    agentName,
    endpoint,
    secret,
    created_at,
    expires_at,
  };
}

/**
 * 创建 contact link code。
 */
export function createContactLinkCode(payload: ContactLinkCodePayload): string {
  return `${CONTACT_LINK_PREFIX}${encodeJson(payload)}`;
}

/**
 * 解析 contact link code。
 */
export function parseContactLinkCode(code: string): ContactLinkCodePayload {
  const value = String(code || "").trim();
  if (!value.startsWith(CONTACT_LINK_PREFIX)) {
    throw new Error("Invalid contact link code prefix");
  }
  return decodeJson(value.slice(CONTACT_LINK_PREFIX.length));
}

/**
 * 判断 link code 是否过期。
 */
export function isContactLinkExpired(
  payload: Pick<ContactLinkCodePayload, "expires_at">,
  nowMs: number = Date.now(),
): boolean {
  return Number(payload.expires_at) <= nowMs;
}
