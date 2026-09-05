/**
 * Desktop 通知领域 store。
 *
 * 独立拥有主进程通知订阅与最新不可变快照，使未读状态变化只失效通知消费者。
 */

import { useEffect, useMemo } from "react";
import type { DesktopNotificationState } from "@common/types/DesktopNotification";
import { use_store } from "@/lib/store";

const initial_notification_state: DesktopNotificationState = {
  revision: 0,
  notifications: [],
  unread_count: 0,
};

/** 创建并维护 Desktop 通知状态。 */
export function use_notification_store(set_error: (message: string) => void) {
  const { store, state_ref, commit } = use_store<DesktopNotificationState>(initial_notification_state);

  useEffect(() => {
    let active = true;
    const commit_notification_state = (next: DesktopNotificationState) => {
      if (!active || next.revision < state_ref.current.revision) return;
      commit(next);
    };
    const unsubscribe = window.downcity.notification.subscribe(commit_notification_state);
    void window.downcity.notification.get_state()
      .then(commit_notification_state)
      .catch((reason: unknown) => {
        if (active) set_error(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [commit, set_error, state_ref]);

  return useMemo(() => ({ store, state_ref }), [state_ref, store]);
}
