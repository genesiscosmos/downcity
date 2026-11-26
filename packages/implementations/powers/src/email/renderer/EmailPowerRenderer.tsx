/**
 * Email Power 工作区入口。完整账号列表打开独立邮件与设置视图。
 * 所有业务动作显式使用用户选择的 Agent；Desktop 通过工厂注入原生 Chat 导航。
 */
import { useEffect, useState } from "react";
import { define_power_renderer } from "@downcity/city/power/react";
import type {
  PowerPageComponentProps,
} from "@downcity/city/power/react";
import type {
  EmailAgentSnapshot,
  EmailConfigSnapshot,
  EmailRendererOptions,
} from "../types/EmailDesktop.js";
import { EmailInbox } from "./EmailInbox.js";
import { EmailSettings } from "./EmailSettings.js";
import { email_error } from "./EmailShared.js";
import { EMAIL_ACTIVITY_RENDERER } from "./EmailActivity.js";

/** 只接受字符串路由值，避免把不可信 JSON 直接用作账号或 Agent 身份。 */
function route_text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 账号列表只展示配置，不触发联网收取，也不自行推断连接状态。 */
function email_page({ power, navigation, ui }: PowerPageComponentProps) {
  const {
    Button,
    Callout,
    EmptyState,
    LoadingState,
    Page, List, Input,
    CreateMenu,
    ListItem,
    ListSection,
  } = ui.components;
  const [snapshot, set_snapshot] = useState<EmailConfigSnapshot>();
  const [error, set_error] = useState("");
  const [revision, set_revision] = useState(0);
  useEffect(() => {
    let disposed = false;
    set_error("");
    void power
      .invoke<EmailConfigSnapshot>("email.config.read")
      .then((next) => {
        if (!disposed) set_snapshot(next);
      })
      .catch((reason) => {
        if (!disposed) set_error(email_error(reason));
      });
    return () => {
      disposed = true;
    };
  }, [power, ui.revision, revision]);
  const [query, set_query] = useState("");
  const agent_id = route_text(navigation.route.agent_id);
  const open_account = (account_id: string, title: string, view = "inbox") => ui.open_view({
    view_id: "email_account", resource_key: account_id || "create", title,
    input: { account_id, agent_id, view },
  });
  return (
    <Page><List
      actions={
        <CreateMenu
          label="添加邮箱"
          actions={[
            {
              action_id: "create",
              label: "添加邮箱",
              on_select: () =>
                open_account("", "添加邮箱", "create"),
            },
          ]}
        />
      }
      toolbar={<Input type="search" value={query} placeholder="搜索邮箱…" on_value_change={set_query} />}
    >
      <ListSection label="邮箱账号">
        {snapshot?.accounts.filter((account) => `${account.label} ${account.address}`.toLowerCase().includes(query.trim().toLowerCase())).map((account) => (
          <ListItem
            key={account.id}
            label={account.label}
            description={account.address}
            on_select={() => open_account(account.id, account.label)}
          />
        ))}
        {!snapshot && !error ? (
          <LoadingState label="正在读取邮箱账号…" />
        ) : null}
        {snapshot && !snapshot.accounts.length ? (
          <EmptyState size="compact" title="还没有邮箱账号" />
        ) : null}
      </ListSection>
      {error ? (
        <Callout tone="danger">
          {error}
          <Button on_click={() => set_revision((value) => value + 1)}>
            重试
          </Button>
        </Callout>
      ) : null}
    </List></Page>
  );
}

/** 独立账号视图先选执行身份，再挂载该身份和账号拥有的邮箱工作区。 */
function Email_account_content({
  power,
  navigation,
  ui,
  options,
}: Pick<PowerPageComponentProps, "power" | "navigation" | "ui"> & {
  /** 宿主注入的 Chat 导航，普通只读 Renderer 可以省略。 */
  options?: EmailRendererOptions;
}) {
  const {
    Button,
    Callout,
    EmptyState,
    Field, Inline,
    LoadingState,
    Page,
    Select,
    Toolbar,
  } = ui.components;
  const [snapshot, set_snapshot] = useState<EmailConfigSnapshot>();
  const [agents, set_agents] = useState<EmailAgentSnapshot>();
  const [error, set_error] = useState("");
  const [revision, set_revision] = useState(0);
  useEffect(() => {
    let disposed = false;
    set_error("");
    void Promise.all([
      power.invoke<EmailConfigSnapshot>("email.config.read"),
      power.invoke<EmailAgentSnapshot["agents"]>("email.agents"),
    ])
      .then(([config, agent_snapshot]) => {
        if (disposed) return;
        set_snapshot(config);
        set_agents({ agents: agent_snapshot });
      })
      .catch((reason) => {
        if (!disposed) set_error(email_error(reason));
      });
    return () => {
      disposed = true;
    };
  }, [power, ui.revision, revision]);
  const agent_id = route_text(navigation.route.agent_id);
  const creating = navigation.route.view === "create";
  const account_id =
    route_text(navigation.route.account_id) || snapshot?.accounts[0]?.id || "";
  const account = snapshot?.accounts.find((item) => item.id === account_id);
  const on_saved = (next_id: string) =>
    navigation.navigate({ account_id: next_id, agent_id });
  if (creating || navigation.route.view === "settings")
    return (
      <EmailSettings
        key={creating ? "create" : account_id}
        power={power}
        ui={ui}
        account_id={creating ? "" : account_id}
        on_saved={on_saved}
      />
    );
  if (error)
    return (
      <Page>
        <Callout tone="danger">{error}</Callout>
        <Button on_click={() => set_revision((value) => value + 1)}>
          重试
        </Button>
      </Page>
    );
  if (!snapshot || !agents)
    return <LoadingState label="正在读取 Email 工作区…" />;
  if (!account)
    return (
      <Page>
        <Toolbar
          title="Email"
          actions={
            <Button
              variant="primary"
              on_click={() => navigation.navigate({ view: "create", agent_id })}
            >
              添加邮箱
            </Button>
          }
        />
        <EmptyState
          title={
            snapshot.accounts.length
              ? "请选择邮箱账号"
              : "添加邮箱后开始收发邮件"
          }
        />
      </Page>
    );
  const selected_agent = agents.agents.some(
    (agent) => agent.agent_id === agent_id,
  );
  const scope_control = (
    <Inline><Button on_click={() => navigation.navigate({ account_id, agent_id, view: "settings" })}>邮箱设置</Button><Field label="执行 Agent">
      <Select
        value={selected_agent ? agent_id : ""}
        options={[
          { value: "", label: "选择执行邮件操作的 Agent", disabled: true },
          ...agents.agents.map((agent) => ({
            value: agent.agent_id,
            label: agent.name,
          })),
        ]}
        on_value_change={(value) =>
          navigation.navigate({ account_id, agent_id: value })
        }
      />
    </Field></Inline>
  );
  return selected_agent ? (
    <EmailInbox
      key={`${agent_id}:${account.id}`}
      power={power}
      ui={ui}
      agent_id={agent_id}
      account={account}
      scope_control={scope_control}
      open_session={options?.open_session}
    />
  ) : (
    <Page>
      {scope_control}
      <EmptyState
        title={
          agents.agents.length
            ? "选择 Agent 后读取邮件"
            : "请先为 Agent 启用 Email Power"
        }
      />
    </Page>
  );
}

/** Desktop 使用该工厂注入会话导航，保持 Power 与具体宿主解耦。 */
export function create_email_power_renderer(options?: EmailRendererOptions) {
  return define_power_renderer({
    activity: EMAIL_ACTIVITY_RENDERER,
    page: email_page,
    views: [{ id: "email_account", label: "Email", component: function email_account_view({ input, power, ui }) {
      const [route, set_route] = useState(input);
      return <Email_account_content power={power} ui={ui} navigation={{ route, navigate: set_route }} options={options} />;
    } }],
  });
}

/** 浏览器安全的默认 Renderer，仅依赖宿主统一组件。 */
export const EMAIL_POWER_RENDERER = create_email_power_renderer();
