/**
 * Email Power 工作区入口。侧栏复用宿主账号导航，主区组合邮件与账号设置。
 * 所有业务动作显式使用用户选择的 Agent；Desktop 通过工厂注入原生 Chat 导航。
 */
import { useEffect, useState } from "react";
import { define_power_renderer } from "@downcity/city/power/react";
import type {
  PowerMainviewComponentProps,
  PowerSidebarComponentProps,
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

/** 账号侧栏只展示配置，不触发联网收取，也不自行推断连接状态。 */
function email_sidebar({ power, navigation, ui }: PowerSidebarComponentProps) {
  const {
    Button,
    Callout,
    EmptyState,
    LoadingState,
    Sidebar,
    SidebarCreateMenu,
    SidebarItem,
    SidebarSection,
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
  const creating = navigation.route.view === "create";
  const account_id =
    route_text(navigation.route.account_id) ||
    (creating ? "" : (snapshot?.accounts[0]?.id ?? ""));
  const agent_id = route_text(navigation.route.agent_id);
  return (
    <Sidebar
      actions={
        <SidebarCreateMenu
          label="添加邮箱"
          actions={[
            {
              action_id: "create",
              label: "添加邮箱",
              on_select: () =>
                navigation.navigate({ view: "create", agent_id }),
            },
          ]}
        />
      }
      footer={
        account_id ? (
          <SidebarItem
            label="邮箱设置"
            active={navigation.route.view === "settings"}
            on_select={() =>
              navigation.navigate({ account_id, agent_id, view: "settings" })
            }
          />
        ) : undefined
      }
    >
      <SidebarSection label="邮箱账号">
        {snapshot?.accounts.map((account) => (
          <SidebarItem
            key={account.id}
            label={account.label}
            description={account.address}
            active={
              !creating &&
              navigation.route.view !== "settings" &&
              account_id === account.id
            }
            on_select={() =>
              navigation.navigate({ account_id: account.id, agent_id })
            }
          />
        ))}
        {!snapshot && !error ? (
          <LoadingState label="正在读取邮箱账号…" />
        ) : null}
        {snapshot && !snapshot.accounts.length ? (
          <EmptyState size="compact" title="还没有邮箱账号" />
        ) : null}
      </SidebarSection>
      {error ? (
        <Callout tone="danger">
          {error}
          <Button on_click={() => set_revision((value) => value + 1)}>
            重试
          </Button>
        </Callout>
      ) : null}
    </Sidebar>
  );
}

/** 主视图先选执行身份，再挂载该身份和账号拥有的邮箱工作区。 */
function EmailMainview({
  power,
  navigation,
  ui,
  options,
}: PowerMainviewComponentProps & {
  /** 宿主注入的 Chat 导航，普通只读 Renderer 可以省略。 */
  options?: EmailRendererOptions;
}) {
  const {
    Button,
    Callout,
    EmptyState,
    Field,
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
    <Field label="执行 Agent">
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
    </Field>
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
    sidebar: email_sidebar,
    mainview: function email_mainview(props) {
      return <EmailMainview {...props} options={options} />;
    },
  });
}

/** 浏览器安全的默认 Renderer，仅依赖宿主统一组件。 */
export const EMAIL_POWER_RENDERER = create_email_power_renderer();
