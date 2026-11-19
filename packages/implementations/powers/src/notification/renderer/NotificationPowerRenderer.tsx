/**
 * Notification Power 的 Inbox：侧栏选择事项，主区域展示单项详情与处理表单。
 * Canonical Interaction 的生命周期归原 Session；这里只查询、展示和转发用户响应。
 * Desktop 注入现有表单与专用私密传输，不改变通用 PowerRenderer 协议。
 */
import { define_power_renderer } from "@downcity/city/power/react";
import { NOTIFICATION_ACTIVITY_RENDERER } from "@/builtin/renderer/BuiltinActivity.js";
import type { PowerRendererDefinition } from "@downcity/city/power/react";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";
import { InboxStore } from "./InboxStore.js";
import { InboxSidebar } from "./InboxSidebar.js";
import { InboxMainview } from "./InboxMainview.js";

/** 提供给普通宿主的 Inbox；Desktop 使用工厂注入原有 Interaction 控件。 */
export const NOTIFICATION_POWER_RENDERER = create_notification_power_renderer();

/** 创建具有宿主表单适配能力的 Inbox；不持有 Session 或私密答案。 */
export function create_notification_power_renderer(options: NotificationRendererOptions = {}): PowerRendererDefinition {
  const store = new InboxStore();
  return define_power_renderer({
    activity: NOTIFICATION_ACTIVITY_RENDERER,
    sidebar: function NotificationSidebar(props) {
      return <InboxSidebar {...props} store={store} options={options} />;
    },
    mainview: function NotificationMainview(props) {
      return <InboxMainview {...props} store={store} options={options} />;
    },
  });
}


