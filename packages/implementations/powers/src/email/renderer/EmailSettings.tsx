/**
 * 多邮箱账号编辑器。复用宿主设置行与表单，认证密码只接受新输入，读取配置不回显。
 * 保存前重新读取账号集合，避免编辑单个账号时覆盖其他账号的已保存变更。
 */
import { useEffect, useState } from "react";
import type {
  EmailAccountDraft,
  EmailConfigSnapshot,
  EmailConnectionResult,
  EmailSettingsProps,
} from "../types/EmailDesktop.js";
import {
  account_draft,
  account_patch,
  email_error,
  empty_account,
} from "./EmailShared.js";

/** 编辑单个账号，或创建一个使用 IMAP + SMTP 的账号。 */
export function EmailSettings({
  power,
  ui,
  account_id,
  on_saved,
}: EmailSettingsProps) {
  const {
    Button,
    Callout,
    Field,
    Group,
    Inline,
    Input,
    LoadingState,
    Page,
    Row,
    Section,
    Switch,
    Toolbar,
  } = ui.components;
  const [draft, set_draft] = useState<EmailAccountDraft>();
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState("");
  const [test_result, set_test_result] = useState<EmailConnectionResult>();
  useEffect(() => {
    let disposed = false;
    set_draft(undefined);
    set_error("");
    set_test_result(undefined);
    if (!account_id) {
      set_draft(empty_account());
      return;
    }
    void power
      .invoke<EmailConfigSnapshot>("email.config.read")
      .then((snapshot) => {
        if (disposed) return;
        const account = snapshot.accounts.find(
          (item) => item.id === account_id,
        );
        if (!account) throw new Error("邮箱账号已被移除");
        set_draft(account_draft(account));
      })
      .catch((reason) => {
        if (!disposed) set_error(email_error(reason));
      });
    return () => {
      disposed = true;
    };
  }, [account_id, power]);

  const save = async () => {
    if (!draft) return;
    set_busy(true);
    set_error("");
    try {
      const latest =
        await power.invoke<EmailConfigSnapshot>("email.config.read");
      if (account_id && !latest.accounts.some((item) => item.id === account_id))
        throw new Error("邮箱账号已被移除，请重新添加");
      const accounts = latest.accounts
        .filter((item) => item.id !== draft.id)
        .map(account_patch);
      const saved = await power.invoke<EmailConfigSnapshot>(
        "email.config.save",
        { accounts: [...accounts, account_patch(draft)] },
      );
      const account = saved.accounts.find((item) => item.id === draft.id);
      if (!account) throw new Error("保存后的账号不可用，请重新读取配置");
      set_draft(account_draft(account));
      ui.invalidate();
      ui.toast({ type: "success", message: "邮箱账号已保存" });
      on_saved(account.id);
    } catch (reason) {
      set_error(email_error(reason));
    } finally {
      set_busy(false);
    }
  };
  const remove = async () => {
    if (
      !account_id ||
      !(await ui.confirm({
        title: "移除邮箱账号？",
        description: "仅移除 Downcity 中的连接配置。",
        action: "移除",
        destructive: true,
      }))
    )
      return;
    set_busy(true);
    set_error("");
    try {
      const latest =
        await power.invoke<EmailConfigSnapshot>("email.config.read");
      await power.invoke("email.config.save", {
        accounts: latest.accounts
          .filter((item) => item.id !== account_id)
          .map(account_patch),
      });
      ui.invalidate();
      on_saved("");
    } catch (reason) {
      set_error(email_error(reason));
    } finally {
      set_busy(false);
    }
  };
  const test = async () => {
    set_busy(true);
    set_error("");
    set_test_result(undefined);
    try {
      set_test_result(
        await power.invoke<EmailConnectionResult>("email.config.test", {
          account_id,
        }),
      );
    } catch (reason) {
      set_error(email_error(reason));
    } finally {
      set_busy(false);
    }
  };
  if (!draft)
    return (
      <Page>
        {error ? (
          <Callout tone="danger">{error}</Callout>
        ) : (
          <LoadingState label="正在读取邮箱账号…" />
        )}
      </Page>
    );

  const update_server = (
    kind: "imap" | "smtp",
    field: string,
    value: string | number | boolean,
  ) => {
    set_test_result(undefined);
    set_draft({ ...draft, [kind]: { ...draft[kind], [field]: value } });
  };
  return (
    <Page>
      <Toolbar
        title={account_id ? "邮箱设置" : "添加邮箱"}
        actions={
          <Inline>
            {account_id ? (
              <Button disabled={busy} on_click={() => on_saved(account_id)}>
                返回邮件
              </Button>
            ) : null}
            <Button
              variant="primary"
              disabled={busy}
              on_click={() => void save()}
            >
              {busy ? "处理中…" : "保存"}
            </Button>
          </Inline>
        }
      />
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Section title="账号">
        <Group>
          <Row
            label="名称"
            trailing={
              <Input
                value={draft.label}
                disabled={busy}
                placeholder="工作邮箱"
                on_value_change={(label) => set_draft({ ...draft, label })}
              />
            }
          />
          <Row
            label="邮箱地址"
            trailing={
              <Input
                value={draft.address}
                disabled={busy}
                placeholder="name@example.com"
                on_value_change={(address) => set_draft({ ...draft, address })}
              />
            }
          />
        </Group>
      </Section>
      {(["imap", "smtp"] as const).map((kind) => (
        <Section key={kind} title={kind === "imap" ? "IMAP 收信" : "SMTP 发信"}>
          <Group>
            <Row
              label="服务器"
              trailing={
                <Input
                  value={draft[kind].host}
                  disabled={busy}
                  placeholder={`${kind}.example.com`}
                  on_value_change={(value) =>
                    update_server(kind, "host", value)
                  }
                />
              }
            />
            <Row
              label="端口"
              trailing={
                <Input
                  type="number"
                  minimum={1}
                  maximum={65535}
                  value={String(draft[kind].port)}
                  disabled={busy}
                  on_value_change={(value) =>
                    update_server(kind, "port", Number(value))
                  }
                />
              }
            />
            <Row
              label="隐式 TLS"
              description={
                draft[kind].secure
                  ? "连接时立即使用 TLS。"
                  : "通过 STARTTLS 加密，服务器必须支持。"
              }
              trailing={
                <Switch
                  checked={draft[kind].secure}
                  disabled={busy}
                  aria_label={`${kind.toUpperCase()} 隐式 TLS`}
                  on_checked_change={(value) =>
                    update_server(kind, "secure", value)
                  }
                />
              }
            />
            <Row
              label="用户名"
              trailing={
                <Input
                  value={draft[kind].user}
                  disabled={busy}
                  placeholder="name@example.com"
                  on_value_change={(value) =>
                    update_server(kind, "user", value)
                  }
                />
              }
            />
          </Group>
          <Field
            label="密码或邮箱授权码"
            description={
              draft[`${kind}_password_configured`]
                ? "已配置。留空保留；修改服务器、端口、TLS 或用户名时需重新填写。"
                : "填写该协议使用的密码或邮箱授权码。"
            }
          >
            <Input
              type="password"
              value={draft[kind].password}
              disabled={busy}
              fill
              on_value_change={(value) =>
                update_server(kind, "password", value)
              }
            />
          </Field>
        </Section>
      ))}
      {account_id ? (
        <Section title="连接">
          <Group>
            <Row
              label="验证 IMAP 与 SMTP"
              description="测试已保存的配置，只验证连接与认证。"
              trailing={
                <Button disabled={busy} on_click={() => void test()}>
                  测试连接
                </Button>
              }
            />
          </Group>
          {test_result ? (
            <Callout tone={test_result.success ? "default" : "danger"}>
              {test_result.message}
            </Callout>
          ) : null}
        </Section>
      ) : null}
      {account_id ? (
        <Section>
          <Group>
            <Row
              label="移除账号"
              trailing={
                <Button
                  variant="destructive"
                  disabled={busy}
                  on_click={() => void remove()}
                >
                  移除
                </Button>
              }
            />
          </Group>
        </Section>
      ) : null}
    </Page>
  );
}
