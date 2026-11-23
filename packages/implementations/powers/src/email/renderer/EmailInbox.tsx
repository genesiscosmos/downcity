/**
 * 邮箱的手动读取工作区。账号、Agent、邮箱、搜索与 UIDVALIDITY 共同限定消息身份。
 * 请求切换时丢弃过期结果；读取正文不隐式标记已读，邮件只以纯文本展示。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EmailIdentity, EmailListInput } from "../types/Email.js";
import type {
  EmailDownloadedAttachment,
  EmailInboxProps,
  EmailMailboxSnapshot,
  EmailMessagePage,
  EmailMessageView,
} from "../types/EmailDesktop.js";
import { EmailCompose } from "./EmailCompose.js";
import {
  email_date,
  email_error,
  email_size,
  invoke_email,
} from "./EmailShared.js";

/** 手动浏览、搜索和操作当前邮箱；写信转交真实 Agent 会话。 */
export function EmailInbox({
  power,
  ui,
  agent_id,
  account,
  scope_control,
  open_session,
}: EmailInboxProps) {
  const {
    Button,
    Callout,
    CodeBlock,
    EmptyState,
    Field,
    Group,
    Inline,
    Input,
    LoadingState,
    Page,
    Row,
    Section,
    Select,
    Switch,
    Toolbar,
  } = ui.components;
  const [mailboxes, set_mailboxes] = useState<EmailMailboxSnapshot>();
  const [mailbox, set_mailbox] = useState("");
  const [page, set_page] = useState<EmailMessagePage>();
  const [search_text, set_search_text] = useState("");
  const [search_from, set_search_from] = useState("");
  const [search_subject, set_search_subject] = useState("");
  const [unseen, set_unseen] = useState(false);
  const [query, set_query] = useState<EmailListInput["query"]>({});
  const [selected, set_selected] = useState<EmailIdentity>();
  const [message, set_message] = useState<EmailMessageView>();
  const [attachments, set_attachments] = useState<EmailDownloadedAttachment[]>(
    [],
  );
  const [downloaded, set_downloaded] = useState<EmailDownloadedAttachment>();
  const [compose, set_compose] = useState<"new" | "reply">();
  const [loading, set_loading] = useState(false);
  const [reading, set_reading] = useState(false);
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState("");
  const [mailbox_error, set_mailbox_error] = useState("");
  const list_generation = useRef(0);
  const read_generation = useRef(0);
  const [mailbox_revision, set_mailbox_revision] = useState(0);

  useEffect(() => {
    let disposed = false;
    set_mailbox_error("");
    void invoke_email<EmailMailboxSnapshot>(power, "mailboxes", agent_id, {
      account_id: account.id,
    })
      .then((snapshot) => {
        if (disposed) return;
        set_mailboxes(snapshot);
        const boxes = snapshot.mailboxes.filter((box) => box.selectable);
        set_mailbox((current) =>
          boxes.some((box) => box.path === current)
            ? current
            : (boxes.find((box) => box.path.toUpperCase() === "INBOX")?.path ??
              boxes[0]?.path ??
              ""),
        );
      })
      .catch((reason) => {
        if (!disposed) set_mailbox_error(email_error(reason));
      });
    return () => {
      disposed = true;
    };
  }, [power, agent_id, account.id, mailbox_revision]);

  const load = useCallback(
    async (cursor?: string) => {
      if (!mailbox) return;
      const generation = ++list_generation.current;
      set_loading(true);
      set_error("");
      if (!cursor) set_page(undefined);
      try {
        const next = await invoke_email<EmailMessagePage>(
          power,
          "list",
          agent_id,
          {
            account_id: account.id,
            mailbox,
            query,
            ...(cursor ? { cursor } : {}),
          },
        );
        if (generation !== list_generation.current) return;
        set_page((current) =>
          cursor && current?.uid_validity === next.uid_validity
            ? {
                ...next,
                messages: [
                  ...current.messages,
                  ...next.messages.filter(
                    (item) =>
                      !current.messages.some((old) => old.uid === item.uid),
                  ),
                ],
              }
            : next,
        );
      } catch (reason) {
        if (generation === list_generation.current)
          set_error(email_error(reason));
      } finally {
        if (generation === list_generation.current) set_loading(false);
      }
    },
    [power, agent_id, account.id, mailbox, query],
  );
  useEffect(() => {
    set_selected(undefined);
    set_message(undefined);
    void load();
    return () => {
      list_generation.current++;
    };
  }, [load]);
  useEffect(() => {
    const generation = ++read_generation.current;
    set_message(undefined);
    set_downloaded(undefined);
    if (!selected) {
      set_reading(false);
      return;
    }
    set_reading(true);
    set_error("");
    void invoke_email<EmailMessageView>(power, "read", agent_id, selected)
      .then((next) => {
        if (generation === read_generation.current) set_message(next);
      })
      .catch((reason) => {
        if (generation === read_generation.current)
          set_error(email_error(reason));
      })
      .finally(() => {
        if (generation === read_generation.current) set_reading(false);
      });
    return () => {
      read_generation.current++;
    };
  }, [selected, power, agent_id]);

  const mark_read = async (read: boolean) => {
    if (!selected) return;
    set_busy(true);
    set_error("");
    try {
      await invoke_email(power, "mark_read", agent_id, { ...selected, read });
      set_page((current) =>
        current
          ? {
              ...current,
              messages: current.messages.map((item) =>
                item.uid === selected.uid ? { ...item, read } : item,
              ),
            }
          : current,
      );
      ui.toast({
        type: "success",
        message: read ? "已标为已读" : "已标为未读",
      });
    } catch (reason) {
      set_error(email_error(reason));
    } finally {
      set_busy(false);
    }
  };
  const download = async (attachment_index: number) => {
    if (!selected) return;
    set_busy(true);
    set_error("");
    try {
      const result = await invoke_email<EmailDownloadedAttachment>(
        power,
        "download_attachment",
        agent_id,
        { ...selected, attachment_index },
      );
      set_downloaded(result);
      set_attachments((current) => [...current, result]);
      ui.toast({ type: "success", message: "附件已保存到 Email" });
    } catch (reason) {
      set_error(email_error(reason));
    } finally {
      set_busy(false);
    }
  };
  if (compose)
    return (
      <EmailCompose
        power={power}
        ui={ui}
        agent_id={agent_id}
        account={account}
        reply={compose === "reply" ? message : undefined}
        attachments={attachments}
        open_session={open_session}
        on_close={() => set_compose(undefined)}
      />
    );
  if (selected) {
    const summary = page?.messages.find((item) => item.uid === selected.uid);
    return (
      <Page>
        <Toolbar
          title={message?.subject || "邮件"}
          actions={
            <Inline>
              <Button disabled={busy} on_click={() => set_selected(undefined)}>
                返回列表
              </Button>
              <Button
                disabled={busy || !message}
                on_click={() => set_compose("reply")}
              >
                回复
              </Button>
              <Button
                disabled={busy || !message || !summary}
                on_click={() => void mark_read(!summary?.read)}
              >
                {summary?.read ? "标为未读" : "标为已读"}
              </Button>
            </Inline>
          }
        />
        {error ? <Callout tone="danger">{error}</Callout> : null}
        {reading ? <LoadingState label="正在读取邮件…" /> : null}
        {!reading && !message ? (
          <Button on_click={() => set_selected({ ...selected })}>
            重新读取
          </Button>
        ) : null}
        {message ? (
          <>
            <Section>
              <Group>
                <Row label="发件人" trailing={message.from.join(", ")} />
                <Row label="收件人" trailing={message.to.join(", ")} />
                {message.cc.length ? (
                  <Row label="抄送" trailing={message.cc.join(", ")} />
                ) : null}
                <Row label="日期" trailing={email_date(message.date)} />
              </Group>
            </Section>
            <Section>
              <CodeBlock>{message.text || "（无纯文本正文）"}</CodeBlock>
              {message.truncated ? (
                <Callout tone="warning">正文已达到展示上限。</Callout>
              ) : null}
            </Section>
            {message.attachments.length ? (
              <Section title="附件">
                <Group>
                  {message.attachments.map((attachment) => (
                    <Row
                      key={attachment.attachment_index}
                      label={attachment.filename}
                      description={`${email_size(attachment.size)} · ${attachment.content_type}`}
                      trailing={
                        <Button
                          disabled={busy || attachment.size > 20 * 1024 * 1024}
                          on_click={() =>
                            void download(attachment.attachment_index)
                          }
                        >
                          下载
                        </Button>
                      }
                    />
                  ))}
                </Group>
              </Section>
            ) : null}
            {downloaded ? (
              <Section title="已下载">
                <Group>
                  <Row
                    label={downloaded.filename}
                    description={downloaded.file_path}
                  />
                </Group>
              </Section>
            ) : null}
          </>
        ) : null}
      </Page>
    );
  }
  return (
    <Page>
      {scope_control}
      <Toolbar
        title={account.label}
        description={account.address}
        actions={
          <Inline>
            <Button disabled={loading || !mailbox} on_click={() => void load()}>
              刷新
            </Button>
            <Button variant="primary" on_click={() => set_compose("new")}>
              写邮件
            </Button>
          </Inline>
        }
      />
      {mailbox_error ? (
        <Callout tone="danger">
          {mailbox_error}
          <Button on_click={() => set_mailbox_revision((value) => value + 1)}>
            重试
          </Button>
        </Callout>
      ) : null}
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {!mailboxes && !mailbox_error ? (
        <LoadingState label="正在读取邮箱文件夹…" />
      ) : null}
      {mailboxes && !mailbox ? (
        <EmptyState title="没有可读取的邮箱文件夹" />
      ) : null}
      {mailbox ? (
        <>
          <Section>
            <Field label="文件夹">
              <Select
                value={mailbox}
                disabled={loading}
                options={(mailboxes?.mailboxes ?? [])
                  .filter((box) => box.selectable)
                  .map((box) => ({
                    value: box.path,
                    label: box.name || box.path,
                  }))}
                on_value_change={set_mailbox}
              />
            </Field>
          </Section>
          <Section title="搜索">
            <Group>
              <Row
                label="关键词"
                trailing={
                  <Input
                    type="search"
                    value={search_text}
                    on_value_change={set_search_text}
                  />
                }
              />
              <Row
                label="发件人"
                trailing={
                  <Input
                    value={search_from}
                    on_value_change={set_search_from}
                  />
                }
              />
              <Row
                label="主题"
                trailing={
                  <Input
                    value={search_subject}
                    on_value_change={set_search_subject}
                  />
                }
              />
              <Row
                label="仅未读"
                trailing={
                  <Switch
                    checked={unseen}
                    aria_label="仅搜索未读邮件"
                    on_checked_change={set_unseen}
                  />
                }
              />
            </Group>
            <Inline>
              <Button
                disabled={loading}
                on_click={() =>
                  set_query({
                    text: search_text.trim(),
                    from: search_from.trim(),
                    subject: search_subject.trim(),
                    unseen,
                  })
                }
              >
                搜索
              </Button>
            </Inline>
          </Section>
          <Section title="邮件">
            <Group>
              {page?.messages.map((item) => (
                <Row
                  key={item.uid}
                  label={
                    item.read ? (
                      item.subject || "（无主题）"
                    ) : (
                      <strong>{item.subject || "（无主题）"}</strong>
                    )
                  }
                  description={`${item.from
                    .map((sender) => sender.name || sender.address || "")
                    .filter(Boolean)
                    .join(", ")} · ${email_date(item.date)}`}
                  trailing={item.read ? undefined : "未读"}
                  on_click={() =>
                    set_selected({
                      account_id: account.id,
                      mailbox,
                      uid: item.uid,
                      uid_validity: page.uid_validity,
                    })
                  }
                />
              ))}
            </Group>
            {loading ? <LoadingState label="正在读取邮件…" /> : null}
            {page && !page.messages.length && !loading ? (
              <EmptyState title="没有符合条件的邮件" />
            ) : null}
            {page?.next_cursor ? (
              <Button
                disabled={loading}
                on_click={() => void load(page.next_cursor ?? undefined)}
              >
                加载更多
              </Button>
            ) : null}
          </Section>
        </>
      ) : null}
    </Page>
  );
}
