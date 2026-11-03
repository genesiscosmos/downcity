/** Notification Power对宿主的轻量变化提示，通知与Interaction状态仍由各自所有者持有。 */
export interface NotificationPowerOptions {
  /** 数据或待处理请求变化时刷新界面和角标，不包含私密答案。 */
  on_changed?: () => void | Promise<void>;
}
