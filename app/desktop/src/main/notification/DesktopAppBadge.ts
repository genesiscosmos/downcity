/** 使用 Electron 原生能力投影 Desktop 未读通知角标。 */

import type { App } from "electron";
import type { DesktopNotificationBadge } from "../types/notification/Notification.js";

/** 将未读数量同步到当前平台支持的应用图标角标。 */
export class DesktopAppBadge implements DesktopNotificationBadge {
  /** 当前 Electron 应用实例。 */
  private readonly electron_app: App;

  constructor(electron_app: App) {
    this.electron_app = electron_app;
  }

  /** macOS/Linux 使用 Electron 原生数量角标；不支持的平台安全忽略。 */
  update(unread_count: number): void {
    const normalized_count = Math.max(0, Math.trunc(unread_count));
    this.electron_app.setBadgeCount(normalized_count);
  }
}
