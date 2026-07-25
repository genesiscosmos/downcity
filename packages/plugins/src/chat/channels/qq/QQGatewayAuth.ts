/**
 * QQ Gateway 鉴权与探活辅助函数。
 *
 * 关键点（中文）
 * - Access Token、Gateway URL、HTTP 连通性测试都放在这里。
 * - `QQGatewayClient` 只负责编排状态，不再直接内嵌所有 OpenAPI 请求细节。
 */

import type { Logger } from "@downcity/agent";
import type { ChatChannelTestResult } from "@/chat/types/ChannelStatus.js";
import type { QqGatewayRuntimeStatus } from "@/chat/channels/qq/types/QqChannel.js";

/**
 * Access Token 获取结果。
 */
export interface QqAccessTokenResult {
  /**
   * 最新 access token。
   */
  accessToken: string;
  /**
   * token 过期时间戳（毫秒）。
   */
  accessTokenExpiresAtMs: number;
}

/**
 * 获取 QQ Access Token 所需参数。
 */
export interface FetchQqAccessTokenParams {
  /**
   * 日志器。
   */
  logger: Logger;
  /**
   * 鉴权 API 基础地址。
   */
  authApiBase: string;
  /**
   * QQ appId。
   */
  appId: string;
  /**
   * QQ appSecret。
   */
  appSecret: string;
  /**
   * 当前缓存 token。
   */
  cachedAccessToken: string;
  /**
   * 当前缓存 token 过期时间。
   */
  cachedAccessTokenExpiresAtMs: number;
}

/**
 * 获取 Gateway URL 所需参数。
 */
export interface FetchQqGatewayUrlParams {
  /**
   * 日志器。
   */
  logger: Logger;
  /**
   * OpenAPI 基础地址。
   */
  apiBase: string;
  /**
   * Bearer 鉴权头。
   */
  authToken: string;
  /**
   * 获取失败时使用的默认 ws 地址。
   */
  fallbackWsGateway: string;
}

/**
 * QQ 连通性测试参数。
 */
export interface TestQqGatewayConnectionParams {
  /**
   * appId。
   */
  appId: string;
  /**
   * appSecret。
   */
  appSecret: string;
  /**
   * 是否沙箱环境。
   */
  useSandbox: boolean;
  /**
   * OpenAPI 基础地址。
   */
  apiBase: string;
  /**
   * 获取鉴权 token 的回调。
   */
  getAuthToken: () => Promise<string>;
  /**
   * 读取当前 runtime 状态的回调。
   */
  getExecutorStatus: () => QqGatewayRuntimeStatus;
  /**
   * 当探活发现异常时触发重连的回调。
   */
  requestReconnect: (reason: string, delay_ms?: number) => void;
}

/**
 * 获取并刷新 QQ Access Token。
 */
export async function fetchQqAccessToken(
  params: FetchQqAccessTokenParams,
): Promise<QqAccessTokenResult> {
  if (
    params.cachedAccessToken &&
    Date.now() < params.cachedAccessTokenExpiresAtMs - 60000
  ) {
    return {
      accessToken: params.cachedAccessToken,
      accessTokenExpiresAtMs: params.cachedAccessTokenExpiresAtMs,
    };
  }

  try {
    params.logger.info(`正在获取 Access Token... (API: ${params.authApiBase})`);

    const requestBody = {
      appId: params.appId,
      clientSecret: params.appSecret,
    };
    params.logger.debug(`请求体: ${JSON.stringify(requestBody)}`);

    const response = await fetch(`${params.authApiBase}/app/getAppAccessToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    params.logger.info(`Access Token 响应状态: ${response.status}`);
    params.logger.debug(`Access Token 响应内容: ${responseText}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText}`);
    }

    const data = JSON.parse(responseText) as {
      access_token?: string;
      expires_in?: number;
      code?: number;
      message?: string;
    };
    if (data.code && data.code !== 0) {
      throw new Error(`API 错误 ${data.code}: ${data.message}`);
    }
    if (!data.access_token) {
      throw new Error(`响应中没有 access_token: ${responseText}`);
    }

    const expiresInSeconds = data.expires_in || 7200;
    params.logger.info(`Access Token 获取成功，有效期: ${expiresInSeconds} 秒`);
    return {
      accessToken: data.access_token,
      accessTokenExpiresAtMs: Date.now() + expiresInSeconds * 1000,
    };
  } catch (error) {
    params.logger.error(`获取 Access Token 失败: ${String(error)}`);
    throw error;
  }
}

/**
 * 获取 QQ Gateway 地址。
 */
export async function fetchQqGatewayUrl(
  params: FetchQqGatewayUrlParams,
): Promise<string> {
  try {
    params.logger.info(`正在获取 Gateway 地址... (API: ${params.apiBase})`);
    const response = await fetch(`${params.apiBase}/gateway`, {
      method: "GET",
      headers: {
        Authorization: params.authToken,
      },
    });
    const responseText = await response.text();
    params.logger.info(`Gateway 响应状态: ${response.status}`);
    params.logger.debug(`Gateway 响应内容: ${responseText}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText}`);
    }

    const data = JSON.parse(responseText) as {
      url?: string;
      code?: number;
      message?: string;
    };
    if (data.code && data.code !== 0) {
      throw new Error(`API 错误 ${data.code}: ${data.message}`);
    }
    if (!data.url) {
      throw new Error(`响应中没有 gateway url: ${responseText}`);
    }

    params.logger.info(`Gateway 地址: ${data.url}`);
    return data.url;
  } catch (error) {
    params.logger.error(`获取 Gateway 地址失败: ${String(error)}`);
    params.logger.warn(`使用默认 Gateway 地址: ${params.fallbackWsGateway}`);
    return params.fallbackWsGateway;
  }
}

/**
 * 执行 QQ HTTP 连通性测试。
 */
export async function testQqGatewayConnection(
  params: TestQqGatewayConnectionParams,
): Promise<ChatChannelTestResult> {
  const startedAt = Date.now();
  if (!params.appId || !params.appSecret) {
    return {
      channel: "qq",
      success: false,
      testedAtMs: startedAt,
      message: "App credentials are missing",
    };
  }

  try {
    const authToken = await params.getAuthToken();
    const response = await fetch(`${params.apiBase}/gateway`, {
      method: "GET",
      headers: {
        Authorization: authToken,
      },
    });
    const raw = await response.text();
    const now = Date.now();
    let code: number | undefined;
    try {
      const parsed = JSON.parse(raw) as { code?: number };
      code = typeof parsed.code === "number" ? parsed.code : undefined;
    } catch {
      // ignore parse error
    }

    if (response.ok && (code === 0 || code === undefined)) {
      const runtime = params.getExecutorStatus();
      if (runtime.linkState !== "connected") {
        if (runtime.statusText === "heartbeat_timeout") {
          params.requestReconnect("test_detected_heartbeat_timeout", 0);
        }
        return {
          channel: "qq",
          success: false,
          testedAtMs: now,
          latencyMs: now - startedAt,
          message: `QQ Open API reachable, but WS is not ready (${runtime.statusText})`,
          detail: {
            httpStatus: response.status,
            code: code ?? null,
            sandbox: params.useSandbox,
            linkState: runtime.linkState,
            statusText: runtime.statusText,
          },
        };
      }
      return {
        channel: "qq",
        success: true,
        testedAtMs: now,
        latencyMs: now - startedAt,
        message: "Connected to QQ Open API",
        detail: {
          httpStatus: response.status,
          code: code ?? null,
          sandbox: params.useSandbox,
          linkState: runtime.linkState,
          statusText: runtime.statusText,
        },
      };
    }

    return {
      channel: "qq",
      success: false,
      testedAtMs: now,
      latencyMs: now - startedAt,
      message: `QQ API check failed: HTTP ${response.status}`,
      detail: {
        httpStatus: response.status,
        code: code ?? null,
        sandbox: params.useSandbox,
      },
    };
  } catch (error) {
    const now = Date.now();
    return {
      channel: "qq",
      success: false,
      testedAtMs: now,
      latencyMs: now - startedAt,
      message: `QQ API check failed: ${String(error)}`,
      detail: {
        sandbox: params.useSandbox,
      },
    };
  }
}
