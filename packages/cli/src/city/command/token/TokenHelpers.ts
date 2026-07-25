/**
 * Token 命令通用工具函数。
 *
 * 关键点（中文）
 * - 负责 token 状态判断、格式化与剪贴板等纯工具逻辑。
 * - 不依赖任何交互流程，可被渲染与动作模块复用。
 */

import { spawnSync } from "node:child_process";
import type { AuthTokenSummary } from "@downcity/type";

/**
 * 当前是否为交互式终端。
 */
export function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * 判断 token 是否已过期。
 */
export function isTokenExpired(token: AuthTokenSummary): boolean {
  if (!token.expires_at) return false;
  return new Date(token.expires_at).getTime() <= Date.now();
}

/**
 * 解析 token 状态。
 */
export function resolveTokenState(token: AuthTokenSummary): "active" | "expired" {
  if (isTokenExpired(token)) return "expired";
  return "active";
}

/**
 * 格式化 token 状态标签。
 */
export function formatTokenStateLabel(token: AuthTokenSummary): string {
  const state = resolveTokenState(token);
  if (state === "expired") return "expired";
  return "active";
}

/**
 * 根据 token 状态解析视觉语气。
 */
export function resolveTokenTone(token: AuthTokenSummary): "accent" | "warning" {
  const state = resolveTokenState(token);
  if (state === "active") return "accent";
  return "warning";
}

/**
 * 构建 token 详情事实列表。
 */
export function buildTokenFacts(token: AuthTokenSummary): Array<{ label: string; value: string }> {
  return [
    {
      label: "Id",
      value: token.id,
    },
    {
      label: "State",
      value: formatTokenStateLabel(token),
    },
    {
      label: "Created",
      value: token.created_at,
    },
    ...(token.updated_at
      ? [
          {
            label: "Updated",
            value: token.updated_at,
          },
        ]
      : []),
    ...(token.last_used_at
      ? [
          {
            label: "Last used",
            value: token.last_used_at,
          },
        ]
      : []),
    ...(token.expires_at
      ? [
          {
            label: "Expires",
            value: token.expires_at,
          },
        ]
      : []),
  ];
}

/**
 * 复制文本到系统剪贴板。
 *
 * 关键点（中文）
 * - 依次尝试 pbcopy / wl-copy / xclip / clip。
 * - 返回使用的后端命令，便于提示用户。
 */
export function copyTextToClipboard(text: string): { success: boolean; backend?: string } {
  const value = String(text || "");
  if (!value) return { success: false };

  const backends = [
    {
      command: "pbcopy",
      args: [] as string[],
    },
    {
      command: "wl-copy",
      args: [] as string[],
    },
    {
      command: "xclip",
      args: ["-selection", "clipboard"],
    },
    {
      command: "clip",
      args: [] as string[],
    },
  ];

  for (const backend of backends) {
    const result = spawnSync(backend.command, backend.args, {
      input: value,
      encoding: "utf8",
    });
    if (!result.error && result.status === 0) {
      return {
        success: true,
        backend: backend.command,
      };
    }
  }

  return { success: false };
}
