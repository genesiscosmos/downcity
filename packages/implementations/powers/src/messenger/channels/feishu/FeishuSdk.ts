/**
 * Feishu SDK 延迟加载器。
 *
 * 关键点（中文）
 * - `@larksuiteoapi/node-sdk` 是 Feishu channel 的可选运行时依赖。
 * - 核心 `@downcity/powers` 入口不能静态 import Feishu SDK，否则宿主无法裁剪依赖。
 * - 只有 Feishu channel 实际启用并创建平台连接时，才解析并加载该 SDK。
 */

import { createRequire } from "node:module";
import type { FeishuSdkModule } from "./types/FeishuSdk.js";

const FEISHU_SDK_PACKAGE_NAME = "@larksuiteoapi/node-sdk";
const FEISHU_SDK_MISSING_ERROR_CODE = "DOWNCITY_FEISHU_SDK_MISSING";
const require_from_current_module = createRequire(import.meta.url);

let cached_sdk: FeishuSdkModule | null = null;

function is_missing_feishu_sdk_error(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code || "") : "";
  return code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";
}

/**
 * 读取插件自身声明的 Feishu SDK 依赖范围。
 *
 * 关键点（中文）
 * - 以 package.json 为唯一事实来源，避免错误信息与依赖声明各自漂移。
 * - 仅在 SDK 缺失、需要给出安装指引时调用，因此不做缓存。
 * - 读取失败时返回空字符串，错误信息退化为不带版本范围，不影响诊断。
 */
function resolve_declared_version_range(): string {
  try {
    const manifest = require_from_current_module("../../../../package.json") as {
      dependencies?: Record<string, string>;
    };
    return String(manifest?.dependencies?.[FEISHU_SDK_PACKAGE_NAME] ?? "").trim();
  } catch {
    return "";
  }
}

function create_missing_feishu_sdk_error(cause: unknown): Error {
  const version_range = resolve_declared_version_range();
  const requirement = version_range
    ? `${FEISHU_SDK_PACKAGE_NAME}@${version_range}`
    : FEISHU_SDK_PACKAGE_NAME;
  const error = new Error(
    `Feishu channel requires ${requirement}. ` +
      `Install it before enabling channel "feishu".`,
  );
  if (error && typeof error === "object") {
    (error as Error & { cause?: unknown; code?: string }).cause = cause;
    (error as Error & { cause?: unknown; code?: string }).code =
      FEISHU_SDK_MISSING_ERROR_CODE;
  }
  return error;
}

function assert_feishu_sdk_module(module_value: unknown): FeishuSdkModule {
  const candidate = module_value as Partial<FeishuSdkModule> | undefined;
  if (
    typeof candidate?.Client !== "function" ||
    typeof candidate?.WSClient !== "function" ||
    typeof candidate?.EventDispatcher !== "function"
  ) {
    throw new Error(
      `Invalid ${FEISHU_SDK_PACKAGE_NAME} module. Expected Client, WSClient and EventDispatcher exports.`,
    );
  }
  return candidate as FeishuSdkModule;
}

/**
 * 加载 Feishu SDK。
 */
export function loadFeishuSdk(): FeishuSdkModule {
  if (cached_sdk) return cached_sdk;
  try {
    const module_value = require_from_current_module(FEISHU_SDK_PACKAGE_NAME);
    cached_sdk = assert_feishu_sdk_module(module_value);
    return cached_sdk;
  } catch (error) {
    if (is_missing_feishu_sdk_error(error)) {
      throw create_missing_feishu_sdk_error(error);
    }
    throw error;
  }
}

/**
 * 判断错误是否为 Feishu SDK 缺失。
 */
export function isMissingFeishuSdkDependencyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code || "") : "";
  return code === FEISHU_SDK_MISSING_ERROR_CODE;
}
