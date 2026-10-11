/**
 * City 交互式 TUI prompt 适配层。
 *
 * 关键点（中文）
 * - 使用 CLI 自己定义的 prompt 协议，统一委托 shared pi-tui runtime。
 * - 内部统一委托 shared pi-tui runtime，和其它 CLI TUI 保持同一套框架。
 */

import { ManagedTuiRuntime } from "@/shared/tui/ManagedTuiRuntime.js";
import { t } from "@/shared/CliLocale.js";
import type { tui_prompt_option } from "@/shared/types/TuiPrompt.js";

/**
 * 单个交互问题。
 */
export interface PromptObject {
  /** 问题类型。 */
  type: "select" | "multiselect" | "text" | "password" | "confirm" | "number";

  /** 结果字段名。 */
  name: string;

  /** 问题标题。 */
  message: string;

  /** 标题下方的状态提示。 */
  subtitle?: string;

  /** 选项列表。 */
  choices?: prompt_choice_option[];

  /** 初始值。 */
  initial?: unknown;

  /** 输入校验。 */
  validate?: (value: any) => true | string;

  /** 最小值。 */
  min?: number;
}

/**
 * 选择类 Prompt 的单个选项。
 */
export interface prompt_choice_option {
  /** 左侧 sidebar 展示标题。 */
  title?: string;

  /** 当前选项聚焦时展示在 main/footer 的说明。 */
  description?: string;

  /** 选中后返回给调用方的业务值。 */
  value?: unknown;

  /**
   * 是否仅作为分区标题展示。
   *
   * 关键点（中文）
   * - true 时该项只负责分隔 sidebar，不参与选择与多选勾选。
   * - TUI 会自动跳过该项，避免 Enter 返回无意义值。
   */
  disabled?: boolean;
}

interface prompt_result_map {
  [key: string]: unknown;
}

export type prompt_choice = NonNullable<PromptObject["choices"]>[number];

/**
 * City 使用的 prompts 默认导出。
 */
export default async function prompts(
  input: PromptObject | PromptObject[],
): Promise<prompt_result_map> {
  const questions = Array.isArray(input) ? input : [input];
  const answers: prompt_result_map = {};

  for (const question of questions) {
    const value = await run_prompt_question(question);
    if (value === undefined) {
      return answers;
    }
    answers[question.name] = value;
  }

  return answers;
}

async function run_prompt_question(question: PromptObject): Promise<unknown> {
  if (question.type === "select") {
    return await run_select_prompt(question);
  }
  if (question.type === "multiselect") {
    return await run_multiselect_prompt(question);
  }
  if (question.type === "confirm") {
    return await run_confirm_prompt(question);
  }
  if (question.type === "password") {
    return await run_text_prompt(question, { secret: true });
  }
  if (question.type === "number") {
    return await run_number_prompt(question);
  }
  return await run_text_prompt(question, { secret: false });
}

async function run_select_prompt(question: PromptObject): Promise<unknown> {
  const choices = question.choices ?? [];
  const options = choices.map((choice, index) => to_tui_option(choice, encode_choice_index(index)));
  const runtime = new ManagedTuiRuntime({ title: question.message });
  try {
    const selected = await runtime.select({
      title: question.message,
      subtitle: question.subtitle,
      footer: select_footer_text(),
      options,
      show_detail: true,
      initial_index: normalize_initial_index(question.initial, choices),
    });
    if (selected === undefined) return undefined;
    const selected_index = decode_choice_index(selected);
    return selected_index === null ? undefined : choices[selected_index]?.value;
  } finally {
    runtime.close();
  }
}

async function run_multiselect_prompt(question: PromptObject): Promise<unknown[] | undefined> {
  const choices = question.choices ?? [];
  const options = choices.map((choice, index) => to_tui_option(choice, encode_choice_index(index)));
  const runtime = new ManagedTuiRuntime({ title: question.message });
  try {
    const selected_values = await runtime.multiselect({
      title: question.message,
      subtitle: question.subtitle,
      footer: multiselect_footer_text(),
      options,
      initial_values: normalize_initial_values(question.initial, choices),
    });
    if (selected_values === undefined) return undefined;
    const selected_indexes = new Set(
      selected_values
        .map((value) => decode_choice_index(value))
        .filter((value): value is number => value !== null),
    );
    return choices
      .filter((_choice, index) => selected_indexes.has(index))
      .map((choice) => choice.value)
      .filter((value) => value !== undefined);
  } finally {
    runtime.close();
  }
}

async function run_confirm_prompt(question: PromptObject): Promise<boolean | undefined> {
  const choices: prompt_choice[] = [
    {
      title: t({ zh: "是", en: "Yes" }),
      description: t({ zh: "确认执行该动作", en: "Confirm this action" }),
      value: true,
    },
    {
      title: t({ zh: "否", en: "No" }),
      description: t({ zh: "取消并返回", en: "Cancel and go back" }),
      value: false,
    },
  ];
  if (question.initial !== true) {
    choices.reverse();
  }

  const runtime = new ManagedTuiRuntime({ title: question.message });
  try {
    const selected = await runtime.select({
      title: question.message,
      subtitle: question.subtitle,
      footer: confirm_footer_text(),
      options: choices.map((choice, index) => to_tui_option(choice, encode_choice_index(index))),
      show_detail: true,
    });
    if (selected === undefined) return undefined;
    const selected_index = decode_choice_index(selected);
    return choices[selected_index ?? -1]?.value === true;
  } finally {
    runtime.close();
  }
}

async function run_text_prompt(
  question: PromptObject,
  options: { secret: boolean },
): Promise<string | undefined> {
  let error_message = "";

  while (true) {
    const runtime = new ManagedTuiRuntime({ title: question.message });
    try {
      const submitted_value = await runtime.text({
        title: error_message ? `${question.message}\n${error_message}` : question.message,
        placeholder: String(question.initial ?? ""),
        password: options.secret,
      });
      if (submitted_value === undefined) {
        return undefined;
      }

      const validated = await validate_prompt_value(question, submitted_value);
      if (validated === true) {
        return submitted_value;
      }
      error_message = validated;
    } finally {
      runtime.close();
    }
  }
}

async function run_number_prompt(question: PromptObject): Promise<number | undefined> {
  let error_message = "";

  while (true) {
    const runtime = new ManagedTuiRuntime({ title: question.message });
    try {
      const submitted_value = await runtime.text({
        title: error_message ? `${question.message}\n${error_message}` : question.message,
        placeholder: String(question.initial ?? ""),
      });
      if (submitted_value === undefined) {
        return undefined;
      }

      const parsed_value = Number(submitted_value);
      if (!Number.isFinite(parsed_value)) {
        error_message = t({ zh: "请输入有效数字", en: "Please enter a valid number" });
        continue;
      }
      if (typeof question.min === "number" && parsed_value < question.min) {
        error_message = t({
          zh: `最小值为 ${question.min}`,
          en: `Minimum value is ${question.min}`,
        });
        continue;
      }

      const validated = await validate_prompt_value(question, parsed_value);
      if (validated === true) {
        return parsed_value;
      }
      error_message = validated;
    } finally {
      runtime.close();
    }
  }
}

async function validate_prompt_value(
  question: PromptObject,
  value: unknown,
): Promise<true | string> {
  if (!question.validate) {
    return true;
  }
  const result = await question.validate(value);
  return result === true
    ? true
    : String(result || t({ zh: "输入无效", en: "Invalid input" }));
}

function to_tui_option(choice: prompt_choice, value: string): tui_prompt_option {
  return {
    label: format_choice_label(choice),
    value,
    hint: choice_description(choice),
    disabled: choice.disabled,
  };
}

function format_choice_label(choice?: {
  title?: string;
}): string {
  return String(choice?.title || "").trim();
}

function choice_description(choice?: {
  title?: string;
  description?: string;
  disabled?: boolean;
}): string {
  if (choice?.disabled === true) {
    return t({
      zh: "这是侧边栏分区标题，用于区分当前菜单里的操作区域。",
      en: "This is a sidebar section heading used to group actions in the current menu.",
    });
  }
  const hint = String(choice?.description || "").trim();
  if (hint) return hint;
  const title = format_choice_label(choice);
  return t({
    zh: `选择 ${title}`,
    en: `Select ${title}`,
  });
}

function encode_choice_index(index: number): string {
  return `choice:${index}`;
}

function decode_choice_index(value: string): number | null {
  const match = /^choice:(\d+)$/u.exec(value);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : null;
}

function normalize_initial_index(value: unknown, choices: prompt_choice[]): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  const matched_index = choices.findIndex((choice) => Object.is(choice.value, value));
  return matched_index >= 0 ? matched_index : 0;
}

function normalize_initial_values(value: unknown, choices: prompt_choice[]): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => choices.findIndex((choice) => Object.is(choice.value, item)))
    .filter((index) => index >= 0)
    .map(encode_choice_index);
}

function select_footer_text(): string {
  return t({
    zh: "Enter 选择 · Esc 取消 · ↑↓ 切换",
    en: "Enter choose · Esc cancel · ↑↓ navigate",
  });
}

function multiselect_footer_text(): string {
  return t({
    zh: "Space 切换 · Enter 确认 · Esc 取消 · ↑↓ 切换",
    en: "Space toggle · Enter confirm · Esc cancel · ↑↓ navigate",
  });
}

function confirm_footer_text(): string {
  return t({
    zh: "Enter 选择 · Esc 取消",
    en: "Enter choose · Esc cancel",
  });
}
