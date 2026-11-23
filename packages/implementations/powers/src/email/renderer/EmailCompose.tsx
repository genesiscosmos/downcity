/**
 * 纯文本写信与回复表单。提交到真实 Agent Chat 执行及审批；不从宿主 action 绕过发送审批。
 * Chat 已创建后只重试导航，不重复提交，避免网络或导航失败造成重复外发请求。
 */
import { useRef, useState } from "react";
import type { PowerJsonObject } from "@downcity/city/power";
import type {
  EmailComposeProps,
  EmailComposeSession,
  EmailMessageView,
} from "../types/EmailDesktop.js";
import { email_error, email_size } from "./EmailShared.js";

/** 用明确分隔符解析邮箱地址，格式和人数上限仍由核心 schema 校验。 */
function recipient_list(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
/** 与核心回复规则一致地预览收件人：Reply-To 优先，排除自己，回复全部时合并 To/Cc。 */
function reply_recipients(
  message: EmailMessageView,
  address: string,
  reply_all: boolean,
) {
  const own_address = address.toLowerCase();
  const unique = (items: string[]) => [
    ...new Map(
      items
        .filter((item) => item.toLowerCase() !== own_address)
        .map((item) => [item.toLowerCase(), item]),
    ).values(),
  ];
  const primary = message.reply_to.length ? message.reply_to : message.from;
  const to = unique([...primary, ...(reply_all ? message.to : [])]);
  const cc = reply_all
    ? unique(message.cc).filter(
        (item) =>
          !to.some(
            (recipient) => recipient.toLowerCase() === item.toLowerCase(),
          ),
      )
    : [];
  return { to, cc };
}
/** 把用户确认的结构化邮件提交到 Agent 会话，并打开原生审批界面。 */
export function EmailCompose({
  power,
  ui,
  agent_id,
  account,
  reply,
  attachments,
  open_session,
  on_close,
}: EmailComposeProps) {
  const {
    Button,
    Callout,
    Field,
    Group,
    Inline,
    Input,
    Page,
    Row,
    Section,
    Switch,
    Textarea,
    Toolbar,
  } = ui.components;
  const [to, set_to] = useState("");
  const [cc, set_cc] = useState("");
  const [bcc, set_bcc] = useState("");
  const [subject, set_subject] = useState("");
  const [text, set_text] = useState("");
  const [reply_all, set_reply_all] = useState(false);
  const [attachment_ids, set_attachment_ids] = useState<string[]>([]);
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState("");
  const [submitted, set_submitted] = useState<EmailComposeSession>();
  const recipients = reply
    ? reply_recipients(reply, account.address, reply_all)
    : undefined;
  // 同一表单内容的失败重试复用请求 ID，由核心持久请求映射避免重复提交。
  const request_ids = useRef(new Map<string, string>());
  const submit = async () => {
    if (!open_session) return;
    set_busy(true);
    set_error("");
    try {
      let target = submitted;
      if (!target) {
        const input: PowerJsonObject = reply
          ? {
              account_id: account.id,
              mailbox: reply.mailbox,
              uid: reply.uid,
              uid_validity: reply.uid_validity,
              text,
              reply_all,
              attachment_ids,
            }
          : {
              account_id: account.id,
              to: recipient_list(to),
              cc: recipient_list(cc),
              bcc: recipient_list(bcc),
              subject,
              text,
              attachment_ids,
            };
        const action = reply ? "reply" : "send";
        const payload_key = JSON.stringify({ agent_id, action, input });
        const request_id =
          request_ids.current.get(payload_key) ?? crypto.randomUUID();
        request_ids.current.set(payload_key, request_id);
        target = await power.invoke<EmailComposeSession>("email.compose", {
          agent_id,
          request_id,
          action,
          input,
        });
        if (!target?.agent_id || !target.session_id)
          throw new Error(
            "无法确认邮件请求是否已创建，请先检查 Agent 会话再继续",
          );
        set_submitted(target);
      }
      await open_session(target);
    } catch (reason) {
      set_error(email_error(reason));
    } finally {
      set_busy(false);
    }
  };
  return (
    <Page>
      <Toolbar
        title={reply ? `回复：${reply.subject || "（无主题）"}` : "写邮件"}
        description={`发件账号：${account.address}`}
        actions={
          <Inline>
            <Button disabled={busy} on_click={on_close}>
              返回
            </Button>
            <Button
              variant="primary"
              disabled={
                busy ||
                !open_session ||
                (!submitted &&
                  (!text.trim() ||
                    (reply ? !recipients?.to.length : !to.trim())))
              }
              on_click={() => void submit()}
            >
              {busy
                ? "正在提交…"
                : submitted
                  ? "打开 Agent 会话"
                  : "交给 Agent 审批发送"}
            </Button>
          </Inline>
        }
      />
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {submitted ? (
        <Callout tone="default">
          邮件请求已交给
          Agent。请在会话中核对内容并完成审批；当前状态不代表邮件已发送。
        </Callout>
      ) : null}
      {!open_session ? (
        <Callout tone="warning">
          当前界面无法打开 Agent 会话，请在 Agent 对话中发起邮件发送。
        </Callout>
      ) : null}
      <Section title={reply ? "回复内容" : "邮件内容"}>
        {reply ? (
          <Group>
            <Row
              label="收件人"
              trailing={recipients?.to.join(", ") || "没有有效的回复收件人"}
            />
            {recipients?.cc.length ? (
              <Row label="抄送" trailing={recipients.cc.join(", ")} />
            ) : null}
            <Row
              label="回复全部"
              description="包含原 To/Cc 中除自己外的收件人；优先使用原邮件 Reply-To。"
              trailing={
                <Switch
                  aria_label="回复全部"
                  checked={reply_all}
                  disabled={busy || Boolean(submitted)}
                  on_checked_change={set_reply_all}
                />
              }
            />
          </Group>
        ) : (
          <Group>
            <Row
              label="收件人"
              trailing={
                <Input
                  value={to}
                  disabled={busy || Boolean(submitted)}
                  placeholder="多个邮箱用逗号分隔"
                  on_value_change={set_to}
                />
              }
            />
            <Row
              label="抄送"
              trailing={
                <Input
                  value={cc}
                  disabled={busy || Boolean(submitted)}
                  on_value_change={set_cc}
                />
              }
            />
            <Row
              label="密送"
              trailing={
                <Input
                  value={bcc}
                  disabled={busy || Boolean(submitted)}
                  on_value_change={set_bcc}
                />
              }
            />
            <Row
              label="主题"
              trailing={
                <Input
                  value={subject}
                  disabled={busy || Boolean(submitted)}
                  on_value_change={set_subject}
                />
              }
            />
          </Group>
        )}
        <Field label="正文">
          <Textarea
            value={text}
            rows={14}
            disabled={busy || Boolean(submitted)}
            on_value_change={set_text}
          />
        </Field>
      </Section>
      {attachments.length ? (
        <Section title="附件" description="选择本次已下载到 Email 的附件。">
          <Group>
            {attachments.map((attachment) => (
              <Row
                key={attachment.attachment_id}
                label={attachment.filename}
                description={email_size(attachment.size)}
                trailing={
                  <Switch
                    aria_label={`附加 ${attachment.filename}`}
                    checked={attachment_ids.includes(attachment.attachment_id)}
                    disabled={busy || Boolean(submitted)}
                    on_checked_change={(checked) =>
                      set_attachment_ids((current) =>
                        checked
                          ? [...current, attachment.attachment_id]
                          : current.filter(
                              (id) => id !== attachment.attachment_id,
                            ),
                      )
                    }
                  />
                }
              />
            ))}
          </Group>
        </Section>
      ) : null}
    </Page>
  );
}
