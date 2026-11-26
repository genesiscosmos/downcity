/** Notification 完整资源列表；受信宿主表单只在独立详情视图挂载。 */
import { useState } from "react";
import { define_power_renderer } from "@downcity/city/power/react";
import { NOTIFICATION_ACTIVITY_RENDERER } from "@/builtin/renderer/BuiltinActivity.js";
import type { PowerRendererDefinition } from "@downcity/city/power/react";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";
import { InboxStore } from "./InboxStore.js";
import { Inbox_page } from "./InboxPage.js";
import { Inbox_detail_view } from "./InboxDetailView.js";

/** 普通宿主使用标准只读与响应适配。 */
export const NOTIFICATION_POWER_RENDERER = create_notification_power_renderer();

/** 每个详情 tab 独立持有选择和草稿状态，防止多 tab 相互切换表单。 */
export function create_notification_power_renderer(options: NotificationRendererOptions = {}): PowerRendererDefinition {
  return define_power_renderer({
    activity: NOTIFICATION_ACTIVITY_RENDERER,
    page: function notification_page(props) {
      const [store] = useState(() => new InboxStore());
      return <Inbox_page {...props} store={store} options={options} />;
    },
    views: [{ id: "inbox_detail", label: "Inbox", component: function notification_detail(props) {
      const [store] = useState(() => new InboxStore());
      return <Inbox_detail_view {...props} store={store} options={options} />;
    } }],
  });
}
