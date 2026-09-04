/**
 * Federation 交互式 prompt 适配层。
 *
 * 关键点（中文）
 * - 本模块对 Federation 业务保留 clack 风格的 select / text / password / confirm API。
 * - 内部统一委托 shared pi-tui runtime，和其它 CLI TUI 保持同一套框架。
 */

import { ManagedTuiRuntime } from "@/shared/tui/ManagedTuiRuntime.js";
import { t } from "@/shared/CliLocale.js";
import type { tui_prompt_option } from "@/shared/types/TuiPrompt.js";

interface prompt_select_option {
  /** 展示标签。 */
  label: string;
  /** 选中后返回的业务值。 */
  value: unknown;
  /** 详情提示。 */
  hint?: string;
  /** 是否为不可选择分组项。 */
  disabled?: boolean;
}

interface prompt_select_input {
  /** prompt 标题。 */
  message: string;
  /** 选项列表。 */
  options: prompt_select_option[];
}

interface prompt_text_input {
  /** prompt 标题。 */
  message: string;
  /** 初始值。 */
  initialValue?: string;
  /** 占位提示。 */
  placeholder?: string;
  /** 校验函数，返回 true / undefined 表示通过，返回 string 表示错误信息。 */
  validate?: (value: string) => string | true | undefined;
}

interface prompt_confirm_input {
  /** prompt 标题。 */
  message: string;
  /** 初始确认值。 */
  initialValue?: boolean;
}

/**
 * clack 兼容：select。
 */
export async function select(input: prompt_select_input): Promise<unknown> {
  const runtime = new ManagedTuiRuntime({ title: input.message });
  const options = input.options.map((option, index) => to_tui_option(option, encode_option_index(index)));
  try {
    const selected = await runtime.select({
      title: input.message,
      footer: select_footer_text(),
      options,
      show_detail: true,
    });
    if (selected === undefined) return cancel("cancel");
    const selected_index = decode_option_index(selected);
    return selected_index === null ? cancel("cancel") : input.options[selected_index]?.value;
  } finally {
    runtime.close();
  }
}

/**
 * clack 兼容：text。
 */
export async function text(input: prompt_text_input): Promise<unknown> {
  return await run_text_prompt(input, false);
}

/**
 * clack 兼容：password。
 */
export async function password(input: prompt_text_input): Promise<unknown> {
  return await run_text_prompt(input, true);
}

/**
 * clack 兼容：confirm。
 */
export async function confirm(input: prompt_confirm_input): Promise<unknown> {
  const runtime = new ManagedTuiRuntime({ title: input.message });
  const options: prompt_select_option[] = [
    {
      label: t({ zh: "是", en: "Yes" }),
      value: "yes",
      hint: t({ zh: "确认执行该动作", en: "Confirm this action" }),
    },
    {
      label: t({ zh: "否", en: "No" }),
      value: "no",
      hint: t({ zh: "取消并返回", en: "Cancel and go back" }),
    },
  ];
  if (input.initialValue !== true) {
    options.reverse();
  }

  try {
    const selected = await runtime.select({
      title: input.message,
      footer: confirm_footer_text(),
      options: options.map((option, index) => to_tui_option(option, encode_option_index(index))),
      show_detail: true,
    });
    if (selected === undefined) return cancel("cancel");
    const selected_index = decode_option_index(selected);
    return options[selected_index ?? -1]?.value === "yes";
  } finally {
    runtime.close();
  }
}

/**
 * clack 兼容：isCancel。
 */
export function isCancel(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    "__clack_cancel" in value,
  );
}

/**
 * clack 兼容：intro。
 */
export function intro(_message: string): void {
  // 关键点（中文）：全屏 TUI 下不额外打印 intro，避免破坏当前屏幕。
}

/**
 * clack 兼容：log。
 */
export const log = {
  info(message: string): void {
    console.log(message);
  },
  error(message: string): void {
    console.error(message);
  },
  success(message: string): void {
    console.log(message);
  },
};

async function run_text_prompt(
  input: prompt_text_input,
  secret: boolean,
): Promise<unknown> {
  let error_message = "";

  while (true) {
    const runtime = new ManagedTuiRuntime({ title: input.message });
    try {
      const value = await runtime.text({
        title: error_message ? `${input.message}\n${error_message}` : input.message,
        placeholder: input.initialValue ?? input.placeholder,
        password: secret,
      });
      if (value === undefined) return cancel("cancel");
      const normalized_value = String(value ?? "");
      if (!input.validate) return normalized_value;

      const validate_result = input.validate(normalized_value);
      if (validate_result === true || validate_result === undefined) {
        return normalized_value;
      }
      error_message = String(validate_result || "Invalid input");
    } finally {
      runtime.close();
    }
  }
}

function to_tui_option(option: prompt_select_option, value: string): tui_prompt_option {
  return {
    label: option.label,
    value,
    hint: option.hint,
    disabled: option.disabled,
  };
}

function encode_option_index(index: number): string {
  return `option:${index}`;
}

function decode_option_index(value: string): number | null {
  const match = /^option:(\d+)$/u.exec(value);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : null;
}

function select_footer_text(): string {
  return t({
    zh: "Enter 选择 · Esc 取消 · ↑↓ 切换",
    en: "Enter choose · Esc cancel · ↑↓ navigate",
  });
}

function confirm_footer_text(): string {
  return t({
    zh: "Enter 选择 · Esc 取消",
    en: "Enter choose · Esc cancel",
  });
}

function cancel(reason: string): { __clack_cancel: true; reason: string } {
  return {
    __clack_cancel: true,
    reason,
  };
}
