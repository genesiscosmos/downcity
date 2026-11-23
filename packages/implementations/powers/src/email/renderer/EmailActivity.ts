/** Email 动作的轻量活动投影；SMTP 接受仅显示服务器接收，始终不推断最终送达。 */
import { with_activity_error } from "@downcity/city/power/react";
import type {
  PowerActivityProps,
  PowerActivityRenderer,
} from "@downcity/city/power/react";
import {
  action_of,
  args_of,
  call_tone,
  chinese,
  data_of,
  preview,
  text,
} from "@/builtin/renderer/ActivityContent.js";

/** 操作名称按用户意图组织，结果展示不包含密码或原始 SMTP 响应。 */
const action_labels: Readonly<Record<string, readonly [string, string]>> = {
  accounts: ["读取邮件账号", "Read email accounts"],
  mailboxes: ["读取邮箱文件夹", "Read mailboxes"],
  list: ["搜索邮件", "Search email"],
  read: ["读取邮件", "Read email"],
  read_attachment: ["读取邮件附件", "Read email attachment"],
  download_attachment: ["下载邮件附件", "Download email attachment"],
  mark_read: ["更新邮件已读状态", "Update email read status"],
  send: ["发送邮件", "Send email"],
  reply: ["回复邮件", "Reply to email"],
};
/** 按真实调用状态显示阶段；等待审批不能显示为发送成功。 */
function describe(props: PowerActivityProps) {
  const action = action_of(props);
  const zh = chinese(props.locale);
  const args = args_of(props);
  const data = data_of(props);
  const tone = call_tone(props);
  const label =
    action_labels[action]?.[zh ? 0 : 1] ?? (zh ? "处理邮件" : "Process email");
  let title = zh
    ? `${tone === "complete" ? "已完成" : tone === "failed" ? "未完成" : tone === "waiting" ? "等待确认：" : "正在"}${label}`
    : `${tone === "complete" ? "Completed" : tone === "failed" ? "Failed" : tone === "waiting" ? "Awaiting approval:" : "Running:"} ${label}`;
  if (tone === "complete" && ["send", "reply"].includes(action)) {
    title =
      text(data.delivery_status) === "smtp_accepted"
        ? zh
          ? "SMTP 已接受邮件"
          : "SMTP accepted email"
        : zh
          ? "已处理邮件发送请求"
          : "Processed email send request";
  }
  return {
    title,
    tone,
    summary:
      preview(args.subject) ||
      preview(args.mailbox) ||
      preview(args.account_id),
    has_detail: false,
  };
}
/** 外部错误统一交由 City 的标准活动错误详情呈现。 */
export const EMAIL_ACTIVITY_RENDERER: PowerActivityRenderer =
  with_activity_error({ describe });
