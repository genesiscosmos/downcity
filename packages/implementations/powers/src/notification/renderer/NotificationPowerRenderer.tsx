/**
 * Notification Power 的 Inbox：分类侧栏与列表优先的响应式工作区。
 * Canonical Interaction 的生命周期归原 Session；这里只查询、展示和转发用户响应。
 * Desktop 注入现有表单与专用私密传输，不改变通用 PowerRenderer 协议。
 */
import { define_power_renderer } from "@downcity/city/power/react";
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
    sidebar: function NotificationSidebar(props) {
      return <InboxSidebar {...props} store={store} />;
    },
    mainview: function NotificationMainview(props) {
      return <InboxMainview {...props} store={store} options={options} />;
    },
  });
}


