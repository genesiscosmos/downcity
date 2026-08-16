/** Desktop 用户级偏好设置控制器。 */

import type { DesktopSettings } from "../../common/types/DesktopApi.js";
import type { DesktopLocalData } from "../agent/DesktopLocalData.js";

const settings_key = "desktop.settings";
const default_settings: DesktopSettings = {
  show_reasoning: true,
  auto_scroll: true,
  default_agent_id: "",
  open_empty_chat_on_start: false,
  send_message_on_enter: true,
  spellcheck_enabled: false,
  appearance_mode: "system",
  color_theme: "duobox",
  ui_scale: 1,
  proxy_enabled: false,
  proxy_url: "",
  default_text_model_id: "",
  default_image_model_id: "",
};

const appearance_modes = new Set<DesktopSettings["appearance_mode"]>(["light", "dark", "system"]);
const color_themes = new Set<DesktopSettings["color_theme"]>(["duobox", "dim", "forest", "graph", "haze", "mono", "ocean", "sunset", "vercel"]);

/** 读取、校验并持久化 Desktop 用户级偏好。 */
export class DesktopSettingsController {
  /** Desktop 共享本地数据访问入口。 */
  private readonly data: DesktopLocalData;

  constructor(data: DesktopLocalData) {
    this.data = data;
  }

  /** 读取当前完整设置。 */
  get(): DesktopSettings {
    return normalize_settings(this.data.settings.get<Partial<DesktopSettings>>(settings_key));
  }

  /** 合并一份受控设置补丁。 */
  update(patch: Partial<DesktopSettings>): DesktopSettings {
    const current = this.get();
    const next = normalize_settings({ ...current, ...patch });
    if (next.proxy_enabled && !next.proxy_url) throw new Error("启用网络代理前需要填写代理地址");
    this.data.settings.set(settings_key, next);
    return next;
  }
}

/** 把持久化输入收敛成稳定设置快照。 */
export function normalize_settings(input?: Partial<DesktopSettings> | null): DesktopSettings {
  const ui_scale = Number(input?.ui_scale);
  return {
    show_reasoning: typeof input?.show_reasoning === "boolean" ? input.show_reasoning : default_settings.show_reasoning,
    auto_scroll: typeof input?.auto_scroll === "boolean" ? input.auto_scroll : default_settings.auto_scroll,
    default_agent_id: typeof input?.default_agent_id === "string" ? input.default_agent_id.trim() : "",
    open_empty_chat_on_start: typeof input?.open_empty_chat_on_start === "boolean" ? input.open_empty_chat_on_start : default_settings.open_empty_chat_on_start,
    send_message_on_enter: typeof input?.send_message_on_enter === "boolean" ? input.send_message_on_enter : default_settings.send_message_on_enter,
    spellcheck_enabled: typeof input?.spellcheck_enabled === "boolean" ? input.spellcheck_enabled : default_settings.spellcheck_enabled,
    appearance_mode: appearance_modes.has(input?.appearance_mode as DesktopSettings["appearance_mode"])
      ? input!.appearance_mode as DesktopSettings["appearance_mode"]
      : default_settings.appearance_mode,
    color_theme: color_themes.has(input?.color_theme as DesktopSettings["color_theme"])
      ? input!.color_theme as DesktopSettings["color_theme"]
      : default_settings.color_theme,
    ui_scale: Number.isFinite(ui_scale) ? Math.min(1.2, Math.max(0.85, ui_scale)) : default_settings.ui_scale,
    proxy_enabled: typeof input?.proxy_enabled === "boolean" ? input.proxy_enabled : default_settings.proxy_enabled,
    proxy_url: typeof input?.proxy_url === "string" ? input.proxy_url.trim() : default_settings.proxy_url,
    default_text_model_id: typeof input?.default_text_model_id === "string" ? input.default_text_model_id.trim() : default_settings.default_text_model_id,
    default_image_model_id: typeof input?.default_image_model_id === "string" ? input.default_image_model_id.trim() : default_settings.default_image_model_id,
  };
}
