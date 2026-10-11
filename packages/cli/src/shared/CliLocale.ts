/**
 * Downcity CLI 统一语言模块。
 *
 * 关键说明（中文）
 * - 不引入额外依赖，统一承载命令 help、交互提示与常用输出文案的语言切换。
 * - 默认读取 `--lang`、`DC_CLI_LANG`、`LC_ALL`、`LC_MESSAGES`、`LANG`。
 * - 当前仅支持 `zh` / `en`，未识别输入统一回退 `en`。
 */

import type { CliLocale } from "@/shared/types/CliLocale.js";

let current_locale: CliLocale = "en";

type LocaleText = {
  zh: string;
  en: string;
};

/**
 * 双语文案输入。
 */
export interface LocaleTextInput {
  /** 中文文案。 */
  zh: string;
  /** 英文文案。 */
  en: string;
}

/**
 * 从 argv 解析 `--lang`。
 */
export function readLocaleFromArgv(argv: string[]): CliLocale | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();
    if (!token) continue;

    if (token === "--lang") {
      return normalizeLocale(argv[index + 1]);
    }

    if (token.startsWith("--lang=")) {
      return normalizeLocale(token.slice("--lang=".length));
    }
  }
  return undefined;
}

/**
 * 从环境变量解析语言。
 */
export function readLocaleFromEnv(env: NodeJS.ProcessEnv = process.env): CliLocale | undefined {
  const candidates = [
    env.DC_CLI_LANG,
    env.LC_ALL,
    env.LC_MESSAGES,
    env.LANG,
  ];

  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }
  return undefined;
}

/**
 * 综合 argv 与 env 解析语言。
 */
export function resolveCliLocale(params?: {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  persisted_locale?: CliLocale;
  fallback?: CliLocale;
}): CliLocale {
  return (
    readLocaleFromArgv(params?.argv ?? process.argv.slice(2))
    ?? params?.persisted_locale
    ?? readLocaleFromEnv(params?.env ?? process.env)
    ?? params?.fallback
    ?? "en"
  );
}

/**
 * 设置当前 CLI 语言。
 */
export function setCliLocale(locale: CliLocale): void {
  current_locale = locale;
}

/**
 * 读取当前 CLI 语言。
 */
export function getCliLocale(): CliLocale {
  return current_locale;
}

/**
 * 读取当前语言文案。
 */
export function t(input: LocaleTextInput): string {
  const text = normalizeLocaleText(input);
  return text[getCliLocale()];
}

/**
 * 通用 help 文案。
 */
export function helpText(): string {
  return t({
    zh: "显示帮助信息",
    en: "display help for command",
  });
}

/**
 * `--lang` 选项说明。
 */
export function langOptionText(): string {
  return t({
    zh: "指定 CLI 语言（zh|en）",
    en: "set CLI language (zh|en)",
  });
}

/**
 * 规范化语言值。
 */
export function normalizeLocale(value: unknown): CliLocale | undefined {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "zh" || raw.startsWith("zh-") || raw.startsWith("zh_")) return "zh";
  if (raw === "en" || raw.startsWith("en-") || raw.startsWith("en_")) return "en";
  return undefined;
}

function normalizeLocaleText(input: LocaleTextInput): LocaleText {
  return {
    zh: String(input.zh || "").trim(),
    en: String(input.en || "").trim(),
  };
}
