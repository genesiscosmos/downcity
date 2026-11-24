/** Remote 的浏览器安全 Power 插槽：使用 City 自有真实 Renderer，不引入 Desktop 或工具执行能力。 */
import { createElement } from "react";
import { CITY_POWER_RENDERERS, activity_error_reason, input_power_id } from "@downcity/city/power/react";
import { ActivityDetailBoundary, ActivityErrorContent, ActivityIcon, activity_error_original, MarkdownView, resolve_agent_tool_identity, type ActivityHost } from "@downcity/ui";

/** 只注入静态已确认 Power；可安装扩展的目录与 Renderer 地址没有浏览器协议时保持 SDK 默认展示。 */
export function remote_activity_host(locale: string): ActivityHost {
  const powers = new Map(Object.keys(CITY_POWER_RENDERERS).map(name => [name, { title: name === "ai" ? "AI" : name[0].toUpperCase() + name.slice(1) }]));
  const names = new Set(powers.keys());
  const fallback = locale.startsWith("zh") ? "无法显示详情。" : "Details unavailable.";
  const render_text = (text: string) => <MarkdownView layout="embedded" text={text.slice(0, 48_000)} mode="static" />;
  const render_file = (item: { /** 只读附件 URL；此适配不发起媒体或文件读取。 */ url: string; /** 原始附件名称，缺省时显示 URL。 */ filename?: string }) => <span>{item.filename || item.url}</span>;
  return { locale, powers, describe(part, group_summary) {
    if (part.type === "input") {
      const power_name = input_power_id(part);
      const renderer = CITY_POWER_RENDERERS[power_name]?.input;
      if (!renderer) return undefined;
      let description;
      try { description = renderer.describe({ input: part, locale }); } catch { return undefined; }
      if (!description) return null;
      return { icon: <span className="activity-input-icon"><ActivityIcon kind="power" power_name={power_name} /></span>, incoming: true, tone: description.tone, diff_stat: null,
        state: "", identity: description.title, summary: description.file?.label || description.summary || "",
        render_body: group_summary || !description.has_detail || !renderer.detail ? undefined : () => <><ActivityDetailBoundary fallback={fallback}>{createElement(renderer.detail!, { input: part, locale, render_text, render_file })}</ActivityDetailBoundary></>,
      };
    }
    if (part.type !== "tool") return undefined;
    const identity = resolve_agent_tool_identity(part, names);
    if (identity.kind !== "power") return undefined;
    const renderer = CITY_POWER_RENDERERS[identity.power_name]?.activity;
    if (!renderer) return undefined;
    let description;
    try { description = renderer.describe({ tool: part, locale }); } catch { return undefined; }
    // canonical 失败由 SDK 的共享错误正文处理；业务失败也收敛到同一内容组件。
    if (!description || part.state === "failed") return undefined;
    const terminal = part.state === "completed";
    const waiting = !terminal && (part.state === "waiting-user" || part.interactions?.some(item => item.status === "pending"));
    if (waiting && description.tone !== "waiting" || terminal && ["running", "waiting"].includes(description.tone)) return undefined;
    return { icon: <ActivityIcon kind="power" power_name={identity.power_name} />, tone: description.tone, diff_stat: null,
      state: "", identity: description.title, summary: description.resource?.label || description.summary || "",
      render_body: group_summary ? undefined : description.error || description.tone === "failed"
        ? () => <ActivityErrorContent reason={description.error?.reason || activity_error_reason({ tool: part, locale }, description.title)} original={activity_error_original(part)} />
        : !description.has_detail || !renderer.detail ? undefined : () => <ActivityDetailBoundary fallback={fallback}>{createElement(renderer.detail!, { tool: part, locale, render_text, render_file })}</ActivityDetailBoundary>,
    };
  } };
}
