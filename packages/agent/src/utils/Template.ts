/**
 * 字符串模板渲染工具。
 *
 * 职责说明（中文）
 * - 提供统一的 `{{variable}}` 占位符替换能力。
 * - 供 init 模板与 runtime system prompt 渲染复用，避免重复实现。
 */

import type { TemplateVariableMap } from "@/types/common/Template.js";

/**
 * 渲染模板中的 `{{variable}}` 占位符。
 *
 * 关键点（中文）
 * - 变量名支持字母、数字、下划线，且允许写成 `{{ key }}`。
 * - 未提供值的变量保持原样，便于排查模板与变量映射不一致问题。
 */
export function render_template_variables(
  template: string,
  variables: TemplateVariableMap,
): string {
  if (!template) return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key)
      ? String(variables[key])
      : match;
  });
}
