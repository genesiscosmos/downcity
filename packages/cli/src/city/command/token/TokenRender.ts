/**
 * Token 命令输出渲染模块。
 *
 * 关键点（中文）
 * - 统一负责 token 列表、详情、创建成功等文本输出。
 * - 支持 JSON 与人类可读两种模式。
 */

import type { AuthIssuedToken, AuthTokenSummary } from "@downcity/type";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import {
  buildTokenFacts,
  formatTokenStateLabel,
  resolveTokenTone,
  resolveTokenState,
} from "./TokenHelpers.js";

/**
 * 打印 token 列表。
 */
export function printTokenList(tokens: AuthTokenSummary[], json = false): void {
  if (json === true) {
    printResult({
      asJson: true,
      success: true,
      title: "tokens",
      payload: { tokens },
    });
    return;
  }

  if (tokens.length === 0) {
    emitCliBlock({
      tone: "info",
      title: "Tokens",
      summary: "0 configured",
      note: "当前还没有本机 token，可执行 `city token create <name>`。",
    });
    return;
  }

  emitCliList({
    tone: "accent",
    title: "Tokens",
    summary: `${tokens.length} configured`,
    items: tokens.map((item) => ({
      tone: resolveTokenTone(item),
      title: item.name,
      facts: buildTokenFacts(item),
    })),
  });
}

/**
 * 渲染单个 token 详情。
 */
export function emitTokenDetail(token: AuthTokenSummary): void {
  emitCliBlock({
    tone: resolveTokenTone(token),
    title: token.name,
    summary: formatTokenStateLabel(token),
    facts: buildTokenFacts(token),
    note: resolveTokenState(token) === "active"
      ? "历史明文 token 不会被保存；只有新签发时才会显示一次。"
      : undefined,
  });
}

/**
 * 渲染 token 创建成功后的接入说明。
 */
export function emitTokenSetupGuide(token: AuthIssuedToken): void {
  emitCliBlock({
    tone: "info",
    title: "Token ready",
    facts: [
      {
        label: "Name",
        value: token.name,
      },
      {
        label: "Token",
        value: token.token,
      },
      {
        label: "Next",
        value: "把刚创建的 Bearer Token 粘贴到需要访问的 Extension 或脚本环境",
      },
    ],
  });
}
