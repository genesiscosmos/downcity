/**
 * Token 生命周期动作模块。
 *
 * 关键点（中文）
 * - 封装 token 的创建、删除与查询。
 * - 每个动作都自行管理 AuthService 生命周期。
 */

import type { AuthIssuedToken, AuthTokenSummary } from "@downcity/type";
import { AuthService } from "@/city/runtime/auth/AuthService.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";

/**
 * 创建新的本地 CLI token。
 */
export function createToken(params: {
  name: string;
  expires_at?: string;
  json?: boolean;
}): AuthIssuedToken {
  const authService = new AuthService();
  try {
    const issued = authService.createLocalCliToken({
      name: params.name,
      expires_at: params.expires_at,
    });

    if (params.json === true) {
      printResult({
        asJson: true,
        success: true,
        title: "token created",
        payload: { token: issued },
      });
      return issued;
    }

    emitCliBlock({
      tone: "success",
      title: "Token created",
      summary: issued.name,
      facts: [
        {
          label: "Id",
          value: issued.id,
        },
        {
          label: "Token",
          value: issued.token,
        },
      ],
      note: "明文 token 只会在本次创建时显示一次。",
    });
    return issued;
  } finally {
    authService.close();
  }
}

/**
 * 删除指定 token。
 */
export function deleteToken(token_id: string, json = false): void {
  const authService = new AuthService();
  try {
    const tokens = authService.listLocalCliTokens();
    const deleted = tokens.find((item) => item.id === token_id);
    authService.deleteLocalCliToken(token_id);
    if (json === true) {
      printResult({
        asJson: true,
        success: true,
        title: "token deleted",
        payload: { token_id },
      });
      return;
    }

    emitCliBlock({
      tone: "success",
      title: "Token deleted",
      summary: deleted?.name || token_id,
      facts: [
        {
          label: "Id",
          value: token_id,
        },
      ],
    });
  } finally {
    authService.close();
  }
}

/**
 * 加载所有本地 CLI token 摘要。
 */
export function loadLocalCliTokens(): AuthTokenSummary[] {
  const authService = new AuthService();
  try {
    return authService.listLocalCliTokens();
  } finally {
    authService.close();
  }
}
