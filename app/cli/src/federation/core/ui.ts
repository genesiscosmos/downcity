/**
 * UI 工具模块。
 *
 * 提供 CLI 交互所需的输入/输出封装。
 * 模型选择接受通用的 { id, name, hint } 数组，不依赖 server model 类型。
 */

import { isCancel, intro, log } from "@/federation/tui/Prompts.js";

export { intro, log, isCancel };

// ============================================================
// 显示函数
// ============================================================

export function show(text: string): void { log.info(text); }
export function showError(text: string): void { log.error(text); }
export function showSuccess(text: string): void { log.success(text); }
