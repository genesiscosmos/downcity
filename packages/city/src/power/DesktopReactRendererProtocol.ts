/** Desktop React v1 的静态协议规则；其他宿主能力不受此文件的插槽约束。 */

/** 当前 Desktop React 适配器实现的完整协议版本。 */
export const DESKTOP_REACT_RENDERER_PROTOCOL = "downcity.desktop.react.v1";
/** Desktop 宿主支持的协议和选择顺序，明确不声明未知适配器。 */
export const DESKTOP_RENDERER_PROTOCOLS: readonly string[] = Object.freeze([DESKTOP_REACT_RENDERER_PROTOCOL]);

/** 校验 Desktop 自己的可选插槽标记，其他协议不调用此校验器。 */
export function validate_desktop_renderer_capabilities(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.entries(value).some(([key, flag]) => !["page", "config", "message"].includes(key) || typeof flag !== "boolean")) throw new Error("Desktop Renderer capabilities require boolean slot flags");
}
