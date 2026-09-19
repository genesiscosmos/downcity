/** Chat Power 的 Bot Account Sidebar 与管理 Mainview。 */

import { useEffect, useRef, useState } from "react";
import type { PowerJsonValue } from "@downcity/city/power";
import { define_power_renderer } from "@downcity/city/power/react";
import type { ChatAccountDraft, ChatAccountView, ChatProvider } from "@/chat/types/ChatAccount.js";
import type { ChatAccountDetailSnapshot, ChatDesktopSnapshot } from "@/chat/types/ChatDesktop.js";
import type { FeishuAppRegistrationView } from "@/chat/types/FeishuAppRegistration.js";

const account_route = (account_id: string, view = "overview") => ({ account_id, view });
const create_route = (provider: ChatProvider) => ({ view: "create", provider });

/** Chat Power Renderer 定义。 */
export const CHAT_POWER_RENDERER = define_power_renderer({
  sidebar: function ChatPowerSidebar({ power, navigation, ui }) {
    const { Callout, LoadingState, Sidebar, SidebarCreateMenu, SidebarItem, SidebarSection, SidebarSubText, Status } = ui.components;
    const [snapshot, set_snapshot] = useState<ChatDesktopSnapshot>();
    const [error, set_error] = useState("");
    const selected_account_id = read_route(navigation.route.account_id);

    useEffect(() => {
      let disposed = false;
      set_error("");
      const refresh = () => void power.invoke<ChatDesktopSnapshot>("accounts.snapshot")
        .then((value) => { if (!disposed) set_snapshot(value); })
        .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); });
      refresh();
      const timer = setInterval(refresh, 5_000);
      return () => { disposed = true; clearInterval(timer); };
    }, [power, ui.revision]);

    const create_menu = <SidebarCreateMenu label="添加 Channel" actions={provider_options().map((provider) => ({
      action_id: provider.value,
      label: provider.label,
      on_select: () => navigation.navigate(create_route(provider.value)),
    }))} />;

    return <Sidebar actions={create_menu}>
      <SidebarSection label="Bot Accounts">
        {snapshot?.accounts.map((account) => <SidebarItem
          key={account.account_id}
          label={account.name}
          description={provider_label(account.provider)}
          trailing={<Status tone={status_tone(account.connection_state)}>{status_label(account.connection_state)}</Status>}
          active={selected_account_id === account.account_id}
          on_select={() => navigation.navigate(account_route(account.account_id))}
        />)}
        {!snapshot ? <LoadingState label="正在读取 Channels…" /> : null}
        {snapshot && snapshot.accounts.length === 0 ? <SidebarSubText>还没有 Bot Account</SidebarSubText> : null}
      </SidebarSection>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Sidebar>;
  },

  mainview: function ChatPowerMainview({ power, navigation, ui }) {
    const { Button, Callout, EmptyState, Group, Inline, Input, LoadingState, Page, Row, Section, Select, Stack, Status, Switch, Tabs, Toolbar } = ui.components;
    const account_id = read_route(navigation.route.account_id);
    const view = read_route(navigation.route.view) || "overview";
    const create_provider = read_provider_route(navigation.route.provider);
    const [snapshot, set_snapshot] = useState<ChatDesktopSnapshot>();
    const [detail, set_detail] = useState<ChatAccountDetailSnapshot>();
    const [draft, set_draft] = useState<ChatAccountDraft>(() => empty_draft(create_provider));
    const [edit_draft, set_edit_draft] = useState<ChatAccountDraft>();
    const [busy, set_busy] = useState(false);
    const [error, set_error] = useState("");
    const [feishu_registration, set_feishu_registration] = useState<FeishuAppRegistrationView>();
    const [manual_credential_mode, set_manual_credential_mode] = useState(false);
    const committed_registration_id = useRef("");

    useEffect(() => {
      let disposed = false;
      set_error("");
      const refresh = () => void power.invoke<ChatDesktopSnapshot>("accounts.snapshot")
        .then((value) => { if (!disposed) set_snapshot(value); })
        .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); });
      refresh();
      const timer = setInterval(refresh, 5_000);
      return () => { disposed = true; clearInterval(timer); };
    }, [power, ui.revision]);

    useEffect(() => {
      if (!account_id) {
        set_detail(undefined);
        return;
      }
      let disposed = false;
      const refresh = () => void power.invoke<ChatAccountDetailSnapshot>("accounts.detail", { account_id })
        .then((value) => { if (!disposed) set_detail(value); })
        .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); });
      refresh();
      const timer = setInterval(refresh, 5_000);
      return () => { disposed = true; clearInterval(timer); };
    }, [account_id, power, ui.revision]);

    useEffect(() => {
      if (!detail) {
        set_edit_draft(undefined);
        return;
      }
      set_edit_draft(account_view_to_draft(detail.account));
    }, [detail?.account.account_id]);

    useEffect(() => {
      if (view !== "create") return;
      set_draft(empty_draft(create_provider));
      set_feishu_registration(undefined);
      set_manual_credential_mode(false);
      committed_registration_id.current = "";
    }, [create_provider, view]);

    const mutate = async <TResult,>(action_id: string, input: object, message: string): Promise<TResult | undefined> => {
      set_busy(true);
      set_error("");
      try {
        const result = await power.invoke<TResult>(action_id, input as PowerJsonValue);
        ui.invalidate();
        ui.toast({ type: "success", message });
        return result;
      } catch (reason) {
        const message_value = to_error_message(reason);
        set_error(message_value);
        ui.toast({ type: "error", message: message_value });
        return undefined;
      } finally {
        set_busy(false);
      }
    };

    /** 轮询待完成的飞书扫码注册会话。 */
    useEffect(() => {
      if (feishu_registration?.state !== "pending") return;
      const registration_id = feishu_registration.registration_id;
      let disposed = false;
      const timer = setInterval(() => {
        void power.invoke<FeishuAppRegistrationView>("feishu.register.status", { registration_id })
          .then((value) => { if (!disposed) set_feishu_registration(value); })
          .catch((reason) => {
            if (disposed) return;
            set_feishu_registration(undefined);
            set_error(to_error_message(reason));
          });
      }, 3_000);
      return () => { disposed = true; clearInterval(timer); };
    }, [power, feishu_registration?.registration_id, feishu_registration?.state]);

    /** 扫码完成后的唯一一次建号提交，避免 React 重复执行导致重复创建。 */
    useEffect(() => {
      if (feishu_registration?.state !== "ready") return;
      const registration_id = feishu_registration.registration_id;
      const app_id = feishu_registration.app_id;
      const app_secret = feishu_registration.app_secret;
      if (!app_id || !app_secret) return;
      if (committed_registration_id.current === registration_id) return;
      committed_registration_id.current = registration_id;
      void (async () => {
        const created = await mutate<ChatAccountView>("accounts.create", {
          ...draft,
          name: draft.name.trim() || "飞书机器人",
          app_id,
          app_secret,
          ...(feishu_registration.domain ? { domain: feishu_registration.domain } : {}),
        }, "飞书 Bot Account 已创建");
        if (created) navigation.navigate(account_route(created.account_id));
      })();
    }, [feishu_registration?.state]);

    /** 开始一次飞书扫码创建。 */
    const start_feishu_registration = async () => {
      committed_registration_id.current = "";
      const started = await mutate<FeishuAppRegistrationView>(
        "feishu.register.begin",
        {},
        "二维码已生成，请用飞书扫码确认",
      );
      if (started) set_feishu_registration(started);
    };

    /** 取消当前扫码会话，并立刻回到未开始状态。 */
    const cancel_feishu_registration = async () => {
      const current = feishu_registration;
      if (!current) return;
      set_feishu_registration(undefined);
      await power
        .invoke("feishu.register.cancel", { registration_id: current.registration_id })
        .catch(() => undefined);
    };

    if (!snapshot) return <LoadingState label="正在读取 Chat 工作区…" />;
    const agent_options = snapshot.agents.map((agent) => ({ value: agent.agent_id, label: agent.name }));
    const workspace_options = snapshot.workspaces.map((workspace) => ({ value: workspace.workspace_id, label: workspace.name }));
    if (view === "create") {
      const save = async () => {
        const created = await mutate<ChatAccountView>("accounts.create", draft, "Bot Account 已创建");
        if (created) navigation.navigate(account_route(created.account_id));
      };
      return <Page>
        <Toolbar title="添加 Bot Account" actions={<Button variant="primary" disabled={busy || (draft.provider === "feishu" && !manual_credential_mode)} on_click={() => void save()}>创建并启动</Button>} />
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <Section title="Account" description="一个 Account 对应一个真实的平台 Bot/App。">
          <Group>
            <Row label="Platform" trailing={provider_label(draft.provider)} />
            <Row label="Name" trailing={<Input value={draft.name} placeholder="Support Bot" on_value_change={(name) => set_draft({ ...draft, name })} />} />
            <Row label="Enabled" trailing={<Switch checked={draft.enabled} on_checked_change={(enabled) => set_draft({ ...draft, enabled })} aria_label="启用 Bot Account" />} />
          </Group>
        </Section>
        <Section title="Credentials" description={draft.provider === "feishu" && !manual_credential_mode ? "扫码后凭据自动写入并立即启用，不需要手动复制 App ID 与 App Secret。" : undefined}>
          {draft.provider === "feishu" && !manual_credential_mode
            ? feishu_registration?.state === "pending"
              ? <Group>
                <div className="flex flex-col items-center gap-3 py-5">
                  <img
                    src={feishu_registration.qr_data_url}
                    alt="飞书扫码创建应用"
                    className="size-44 shrink-0 rounded-item bg-white p-2 object-contain"
                  />
                  <div className="text-xs text-foreground">用飞书扫描二维码，并在手机上确认创建</div>
                  <div className="max-w-md break-all text-center text-2xs leading-4 text-muted-foreground">{feishu_registration.verification_url}</div>
                </div>
                <Row label="操作" trailing={<Inline><Button disabled={busy} on_click={() => void cancel_feishu_registration()}>取消</Button><Button disabled={busy} on_click={() => void start_feishu_registration()}>重新生成</Button></Inline>} />
              </Group>
              : feishu_registration?.state === "ready"
                ? <Group>
                  <Row label="飞书应用" description="凭据已获取，正在创建并启动 Bot Account。" trailing={<Status tone="success">已授权</Status>} />
                </Group>
                : <Stack>
                {feishu_registration?.error ? <Callout tone="danger">{feishu_registration.error}</Callout> : null}
                <Group>
                  <Row label="飞书应用" description="扫码即可自动创建应用，无需手动到开放平台复制凭据。" trailing={<Button variant="primary" disabled={busy} on_click={() => void start_feishu_registration()}>扫码创建</Button>} />
                  <Row label="手动填写凭据" description="仅在无法扫码，或需要复用已有应用时使用。" trailing={<Switch checked={false} on_checked_change={() => set_manual_credential_mode(true)} aria_label="手动填写飞书凭据" />} />
                </Group>
              </Stack>
            : <Group>
              {draft.provider === "telegram"
                ? <Row label="Bot Token" trailing={<Input type="password" value={draft.bot_token ?? ""} on_value_change={(bot_token) => set_draft({ ...draft, bot_token })} />} />
                : <>
                  <Row label="App ID" trailing={<Input value={draft.app_id ?? ""} on_value_change={(app_id) => set_draft({ ...draft, app_id })} />} />
                  <Row label="App Secret" trailing={<Input type="password" value={draft.app_secret ?? ""} on_value_change={(app_secret) => set_draft({ ...draft, app_secret })} />} />
                </>}
              {draft.provider === "feishu" ? <Row label="API Domain" trailing={<Input value={draft.domain ?? ""} placeholder="https://open.feishu.cn" on_value_change={(domain) => set_draft({ ...draft, domain })} />} /> : null}
              {draft.provider === "feishu" && manual_credential_mode ? <Row label="扫码创建" description="返回扫码方式，由飞书自动颁发凭据。" trailing={<Button on_click={() => set_manual_credential_mode(false)}>返回扫码</Button>} /> : null}
            </Group>}
        </Section>
        <Section title="Default routing" description="可选。只作为新 Conversation 的初始绑定，留空时由 City 默认兜底。">
          <Group>
            <Row label="Agent" trailing={<Select value={draft.agent_id ?? ""} options={agent_options} on_value_change={(agent_id) => set_draft({ ...draft, agent_id })} />} />
            <Row label="Workspace" trailing={<Select value={draft.workspace_id ?? ""} options={workspace_options} on_value_change={(workspace_id) => set_draft({ ...draft, workspace_id })} />} />
          </Group>
        </Section>
      </Page>;
    }

    if (!account_id || !detail) {
      return <Page><EmptyState title="选择一个 Bot Account" description="从左侧选择现有 Bot，或者使用 Channels 标题栏中的加号添加 Channel。" /></Page>;
    }

    const account = detail.account;
    const tabs = [
      { value: "overview", label: "Overview" },
      { value: "settings", label: "Settings" },
      { value: "routing", label: "Routing" },
      { value: "access", label: "Access" },
      { value: "conversations", label: "Conversations", count: detail.conversations.length },
      { value: "reliability", label: "Reliability", count: detail.reliability_failures.length },
      { value: "activity", label: "Activity", count: detail.activity.length },
    ];
    const remove = async () => {
      const confirmed = await ui.confirm({ title: `删除 ${account.name}？`, description: "Connector 和凭据将被删除，Conversation 数据默认保留。", action: "删除", destructive: true });
      if (!confirmed) return;
      const result = await mutate("accounts.delete", { account_id }, "Bot Account 已删除");
      if (result) navigation.navigate({});
    };

    return <Page>
      <Toolbar
        title={account.name}
        description={provider_label(account.provider)}
        leading={<Status tone={status_tone(account.connection_state)}>{status_label(account.connection_state)}</Status>}
        actions={<><Button disabled={busy || !account.enabled} on_click={() => void mutate("accounts.test", { account_id }, "连接测试已完成")}>测试连接</Button><Button disabled={busy || !account.enabled} on_click={() => void mutate("accounts.restart", { account_id }, "Bot 已重连")}>重连</Button><Button variant="destructive" disabled={busy} on_click={() => void remove()}>删除</Button></>}
      />
      <Tabs value={view} label="Bot Account 管理页面" items={tabs} on_value_change={(next) => navigation.navigate(account_route(account_id, next))} />
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {account.last_error ? <Callout tone="danger">{account.last_error}</Callout> : null}
      {view === "overview" ? <Stack>
        <Section title="Connection"><Group>
          <Row label="Status" trailing={<Status tone={status_tone(account.connection_state)}>{status_label(account.connection_state)}</Status>} />
          <Row label="Platform" trailing={provider_label(account.provider)} />
          <Row label="Credentials" trailing={account.credential_configured ? "已配置" : "未配置"} />
          {account.app_id ? <Row label="App ID" trailing={account.app_id} /> : null}
        </Group></Section>
        <Section title="Default routing"><Group>
          <Row label="Agent" trailing={display_agent(snapshot, account.agent_id)} />
          <Row label="Workspace" trailing={display_workspace(snapshot, account.workspace_id)} />
          <Row label="Conversations" trailing={String(detail.conversations.length)} />
        </Group></Section>
      </Stack> : null}
      {view === "settings" && edit_draft ? <Stack>
        <Section title="Account" description="保存后只重启当前 Bot Connector，其他 Account 不受影响。"><Group>
          <Row label="Name" trailing={<Input value={edit_draft.name} on_value_change={(name) => set_edit_draft({ ...edit_draft, name })} />} />
          <Row label="Enabled" trailing={<Switch checked={edit_draft.enabled} on_checked_change={(enabled) => set_edit_draft({ ...edit_draft, enabled })} aria_label="启用 Bot Account" />} />
        </Group></Section>
        <Section title="Credentials" description="密钥不会回显；留空表示保留当前密钥。"><Group>
          {edit_draft.provider === "telegram"
            ? <Row label="Bot Token" trailing={<Input type="password" value={edit_draft.bot_token ?? ""} placeholder="留空保留当前 Token" on_value_change={(bot_token) => set_edit_draft({ ...edit_draft, bot_token })} />} />
            : <>
              <Row label="App ID" trailing={<Input value={edit_draft.app_id ?? ""} on_value_change={(app_id) => set_edit_draft({ ...edit_draft, app_id })} />} />
              <Row label="App Secret" trailing={<Input type="password" value={edit_draft.app_secret ?? ""} placeholder="留空保留当前 Secret" on_value_change={(app_secret) => set_edit_draft({ ...edit_draft, app_secret })} />} />
            </>}
          {edit_draft.provider === "feishu" ? <Row label="API Domain" trailing={<Input value={edit_draft.domain ?? ""} placeholder="https://open.feishu.cn" on_value_change={(domain) => set_edit_draft({ ...edit_draft, domain })} />} /> : null}
        </Group></Section>
        <div><Button variant="primary" disabled={busy} on_click={() => void mutate("accounts.update", edit_draft, "Bot Account 已更新")}>保存并应用</Button></div>
      </Stack> : null}
      {view === "routing" ? <Section title="Default routing" description="只影响之后首次建立的 Conversation；已有 Conversation 保持自己的路由。"><Group>
        <Row label="Agent" trailing={<Select value={edit_draft?.agent_id ?? account.agent_id ?? ""} options={agent_options} on_value_change={(agent_id) => set_edit_draft({ ...(edit_draft ?? account_view_to_draft(account)), agent_id })} />} />
        <Row label="Workspace" trailing={<Select value={edit_draft?.workspace_id ?? account.workspace_id ?? ""} options={workspace_options} on_value_change={(workspace_id) => set_edit_draft({ ...(edit_draft ?? account_view_to_draft(account)), workspace_id })} />} />
        <Row label="Apply" trailing={<Button variant="primary" disabled={busy || !edit_draft} on_click={() => edit_draft && void mutate("accounts.update", edit_draft, "默认路由已更新")}>保存默认路由</Button>} />
      </Group></Section> : null}
      {view === "access" ? <Stack>
        <Section title="Pending requests" description="未批准的外部身份不会进入 Agent。">
          {detail.access.requests.filter((request) => request.status === "pending").length
            ? <Group>{detail.access.requests.filter((request) => request.status === "pending").map((request) => <Row
              key={request.request_id}
              label={request.principal.display_name || request.principal.subject_id}
              description={`${request.scope} · ${request.request_id}`}
              trailing={<><Button disabled={busy} on_click={() => void mutate("access.approve", { request_id: request.request_id }, "访问申请已批准")}>允许</Button><Button variant="destructive" disabled={busy} on_click={() => void mutate("access.deny", { request_id: request.request_id }, "访问申请已拒绝")}>拒绝</Button></>}
            />)}</Group>
            : <EmptyState title="没有待审批申请" />}
        </Section>
        <Section title="Known identities">
          {detail.access.principals.length
            ? <Group>{detail.access.principals.map((item) => <Row
              key={item.principal.principal_id}
              label={item.principal.display_name || item.principal.subject_id}
              description={`${item.principal.channel} · ${item.principal.subject_id}`}
              trailing={item.grants.length ? item.grants.map((grant) => `${grant.scope}:${grant.effect}`).join(" · ") : "未授权"}
            />)}</Group>
            : <EmptyState title="还没有外部身份" />}
        </Section>
      </Stack> : null}
      {view === "conversations" ? <Section title="Conversations" description="每个外部会话拥有独立 Agent Session。">
        {detail.conversations.length ? <Stack>{detail.conversations.map((conversation) => <Group key={conversation.conversation_id} label={conversation.title || conversation.external_chat_id}>
          <Row label="Type" trailing={conversation.chat_type} />
          <Row label="Agent" trailing={<Select value={conversation.agent_id} options={agent_options} on_value_change={(agent_id) => void mutate("conversations.update_route", { conversation_id: conversation.conversation_id, agent_id, workspace_id: conversation.workspace_id }, "Conversation Agent 已更新")} />} />
          <Row label="Workspace" trailing={<Select value={conversation.workspace_id} options={workspace_options} on_value_change={(workspace_id) => void mutate("conversations.update_route", { conversation_id: conversation.conversation_id, agent_id: conversation.agent_id, workspace_id }, "Conversation Workspace 已更新")} />} />
          <Row label="Session" trailing={conversation.session_id} />
          <Row label="Status" trailing={<Switch checked={conversation.status === "active"} on_checked_change={(active) => void mutate("conversations.set_status", { conversation_id: conversation.conversation_id, status: active ? "active" : "paused" }, active ? "Conversation 已恢复" : "Conversation 已暂停")} aria_label="Conversation active" />} />
          <Row label="Session actions" trailing={<Button disabled={busy} on_click={() => void mutate("conversations.reset_session", { conversation_id: conversation.conversation_id }, "Conversation Session 已重置")}>新建 Session</Button>} />
        </Group>)}</Stack> : <EmptyState title="还没有 Conversation" description="Bot 收到第一条允许访问的消息后会自动创建。" />}
      </Section> : null}
      {view === "reliability" ? <Section title="Failed messages" description="达到自动重试上限的 Inbox/Outbox 会停在这里，确认后可以人工重试。">
        {detail.reliability_failures.length ? <Group>{detail.reliability_failures.map((failure) => <Row
          key={`${failure.direction}:${failure.item_id}`}
          label={`${failure.direction.toUpperCase()} · ${failure.item_id}`}
          description={`${failure.error} · 已尝试 ${failure.attempt_count} 次 · ${new Date(failure.updated_at).toLocaleString()}`}
          trailing={<Button disabled={busy} on_click={() => void mutate("reliability.retry", { account_id, direction: failure.direction, item_id: failure.item_id }, "消息已重新加入队列")}>重试</Button>}
        />)}</Group> : <EmptyState title="没有失败任务" description="当前可靠消息队列运行正常。" />}
      </Section> : null}
      {view === "activity" ? <Section title="Activity" description="这里只展示运行诊断，不复制完整 Session 对话。">
        {detail.activity.length ? <Group>{detail.activity.map((activity) => <Row key={activity.activity_id} label={activity.type} description={new Date(activity.created_at).toLocaleString()} />)}</Group> : <EmptyState title="暂无 Activity" />}
      </Section> : null}
    </Page>;
  },
});

/** 返回一个新建 Account 的空草稿。 */
function empty_draft(provider: ChatProvider = "telegram"): ChatAccountDraft {
  return {
    name: "",
    provider,
    enabled: true,
    agent_id: "",
    workspace_id: "",
    ...(provider === "telegram" ? { bot_token: "" } : { app_id: "", app_secret: "" }),
    ...(provider === "feishu" ? { domain: "" } : {}),
  };
}

/** 把不含密钥的 Account View 转成安全编辑草稿。 */
function account_view_to_draft(account: ChatAccountView): ChatAccountDraft {
  return {
    account_id: account.account_id,
    name: account.name,
    provider: account.provider,
    enabled: account.enabled,
    agent_id: account.agent_id,
    workspace_id: account.workspace_id,
    ...(account.provider === "telegram" ? { bot_token: "" } : {
      app_id: account.app_id ?? "",
      app_secret: "",
    }),
    ...(account.provider === "feishu" ? { domain: account.domain ?? "" } : {}),
  };
}

/** 平台下拉选项。 */
function provider_options(): Array<{ readonly value: ChatProvider; readonly label: string }> {
  return [
    { value: "telegram", label: "Telegram" },
    { value: "feishu", label: "飞书 / Lark" },
  ];
}

/** 从创建路由读取受支持的平台，未知值回退到 Telegram。 */
function read_provider_route(value: PowerJsonValue | undefined): ChatProvider {
  const provider = read_route(value);
  return provider === "feishu" ? provider : "telegram";
}

/** 平台用户可见名称。 */
function provider_label(provider: ChatProvider): string {
  if (provider === "telegram") return "Telegram";
  return "Feishu / Lark";
}

/** 状态用户可见名称。 */
function status_label(state: ChatAccountView["connection_state"]): string {
  if (state === "connected") return "已连接";
  if (state === "connecting") return "连接中";
  if (state === "error") return "错误";
  if (state === "disabled") return "已停用";
  return "未连接";
}

/** 把连接状态映射到宿主 Status 语义。 */
function status_tone(state: ChatAccountView["connection_state"]): "success" | "warning" | "danger" | "muted" {
  if (state === "connected") return "success";
  if (state === "connecting") return "warning";
  if (state === "error") return "danger";
  return "muted";
}

/**
 * 显示 Agent 名称并保留稳定 ID。
 *
 * 说明（中文）
 * - 未配置时返回显式文案，避免界面出现空白而让人误以为已绑定。
 */
function display_agent(snapshot: ChatDesktopSnapshot, agent_id: string | undefined): string {
  const value = String(agent_id ?? "").trim();
  if (!value) return "未配置 · 使用 City 默认";
  const agent = snapshot.agents.find((item) => item.agent_id === value);
  return agent ? `${agent.name} · ${value}` : value;
}

/**
 * 显示 Workspace 名称并保留稳定 ID。
 *
 * 说明（中文）
 * - 未配置时返回显式文案，避免界面出现空白而让人误以为已绑定。
 */
function display_workspace(
  snapshot: ChatDesktopSnapshot,
  workspace_id: string | undefined,
): string {
  const value = String(workspace_id ?? "").trim();
  if (!value) return "未配置 · 使用 City 默认";
  const workspace = snapshot.workspaces.find((item) => item.workspace_id === value);
  return workspace ? `${workspace.name} · ${value}` : value;
}

/** 读取 Power 路由字符串。 */
function read_route(value: PowerJsonValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 把未知错误转成用户可见文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
