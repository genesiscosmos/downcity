/** Renderer 声明校验与宿主精确选择。校验只处理数据，绝不加载任何前端模块。 */
import type { PowerRendererBindings, PowerRendererSelection } from "./types/PowerRendererBinding.js";

import { DESKTOP_REACT_RENDERER_PROTOCOL, validate_desktop_renderer_capabilities } from "./DesktopReactRendererProtocol.js";
export { DESKTOP_REACT_RENDERER_PROTOCOL, DESKTOP_RENDERER_PROTOCOLS } from "./DesktopReactRendererProtocol.js";

/** 安全相对文件路径；允许作者常用的 ./ 前缀，拒绝 URL、绝对路径和父目录。 */
export function is_power_renderer_path(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim()
    && !/[\\\u0000:#?]/u.test(value) && !value.startsWith("/")
    && value.split("/").every((part, index) => Boolean(part) && part !== ".." && (part !== "." || index === 0));
}

/** 通用声明只接受 JSON 数据；已知协议的能力约束交给对应校验器。 */
export function validate_power_renderers(value: unknown): PowerRendererBindings {
  if (value === undefined) return Object.freeze({});
  if (!is_record(value)) throw new Error("Power renderers must be an object");
  for (const [protocol_id, binding] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+\.v[1-9][0-9]*$/u.test(protocol_id)) throw new Error(`Invalid Renderer protocol ID: ${protocol_id}`);
    if (!is_record(binding) || Object.keys(binding).some((key) => !["entry", "capabilities", "resources"].includes(key)) || !is_power_renderer_path(binding.entry)) throw new Error(`Invalid Renderer binding: ${protocol_id}`);
    if (binding.capabilities !== undefined && (!is_record(binding.capabilities) || !is_json(binding.capabilities, new Set()))) throw new Error(`Renderer capabilities must be JSON: ${protocol_id}`);
    if (binding.resources !== undefined && (!Array.isArray(binding.resources) || binding.resources.some((file) => !is_power_renderer_path(file)))) throw new Error(`Renderer resources must be relative file paths: ${protocol_id}`);
    if (protocol_id === DESKTOP_REACT_RENDERER_PROTOCOL) validate_desktop_renderer_capabilities(binding.capabilities);
  }
  return structuredClone(value) as PowerRendererBindings;
}

/** 宿主拥有选择顺序；无匹配时返回 undefined，后台能力继续存在。 */
export function select_power_renderer(renderers: PowerRendererBindings | undefined, supported_protocols: readonly string[]): PowerRendererSelection | undefined {
  for (const protocol_id of supported_protocols) {
    if (renderers && Object.hasOwn(renderers, protocol_id)) return { protocol_id, binding: renderers[protocol_id]! };
  }
  return undefined;
}

/** 清单声明的完整前端运行文件集合；不猜测、执行或编译未知协议。 */
export function power_renderer_files(renderers: PowerRendererBindings | undefined): string[] {
  return [...new Set(Object.values(renderers ?? {}).flatMap((binding) => [binding.entry, ...(binding.resources ?? [])]).map((file) => file.replace(/^\.\//u, "")))].sort();
}

function is_record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
}

function is_json(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value) || (!Array.isArray(value) && !is_record(value))) return false;
  ancestors.add(value);
  const valid = Object.values(value).every((item) => is_json(item, ancestors));
  ancestors.delete(value);
  return valid;
}
