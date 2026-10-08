/**
 * 单个 Web 能力的配置与状态视图。
 *
 * 一屏回答三件事：这个能力现在能不能用、用哪一家 Provider、这家需要什么参数。
 * Provider 的选择在侧栏，这里不重复；开关与参数在这里，因为它们是这个能力自己的状态。
 *
 * 保存只提交本能力的字段，因此不会覆盖其它能力未保存的输入。
 */

import { useCallback, useEffect, useState } from "react";
import type { PowerActionGateway, PowerRendererUi } from "@downcity/city/power/react";
import type {
  WebConfigPatch,
  WebConfigTestResult,
  WebConfigView,
  WebCredentialTarget,
} from "@/web/types/WebPowerConfig.js";
import type {
  WebMainviewSessionsResult,
  WebMainviewSnapshot,
} from "@/web/types/WebMainview.js";
import {
  CAPABILITY_ORDER,
  DEFAULT_PROVIDER,
  PROVIDER_FIELD,
  capability_description,
  is_capability_enabled,
  to_config_patch_json,
  to_error_message,
  type WebConfiguredCapability,
} from "@/web/renderer/WebPowerShared.js";
import { WebSecretRow } from "@/web/renderer/WebCapabilityParts.js";

/** 本能力视图的本地编辑状态；只包含该能力自己的可编辑字段。 */
interface CapabilityDraft {
  /** 新 Tavily Key；空值表示保留。 */
  tavily_api_key: string;
  /** 是否清除 Tavily Key。 */
  clear_tavily_api_key: boolean;
  /** 新 Exa Key；空值表示保留。 */
  exa_api_key: string;
  /** 是否清除 Exa Key。 */
  clear_exa_api_key: boolean;
  /** 新 Firecrawl Key；空值表示保留。 */
  firecrawl_api_key: string;
  /** 是否清除 Firecrawl Key。 */
  clear_firecrawl_api_key: boolean;
  /** 外部 CDP 地址。 */
  cdp_url: string;
  /** 本地浏览器可执行路径。 */
  browser_executable_path: string;
  /** 新 Session 默认 URL。 */
  default_url: string;
}

/** 从当前配置构造草稿：输入为空、清除标记为假、数值取服务端当前值。 */
function draft_from(config: WebConfigView): CapabilityDraft {
  return {
    tavily_api_key: "",
    clear_tavily_api_key: false,
    exa_api_key: "",
    clear_exa_api_key: false,
    firecrawl_api_key: "",
    clear_firecrawl_api_key: false,
    cdp_url: config.cdp_url,
    browser_executable_path: config.browser_executable_path,
    default_url: config.default_url,
  };
}

/**
 * 判断某个密钥输入是否应该出现在当前能力下。
 *
 * 搜索的 `auto` 会在 Tavily 与 Exa 之间挑选，因此两个密钥都允许填写；
 * 明确选了其中一个时只显示那一个，避免用户去填一个不会被用到的凭据。
 */
function show_search_key(selected: string, key: "tavily" | "exa"): boolean {
  if (selected === "disabled") return false;
  return selected === "auto" || selected === key;
}

/** 能力视图属性。 */
export interface WebCapabilityViewProps {
  /** 已绑定当前 Power 的业务 action 网关。 */
  readonly power: PowerActionGateway;
  /** 宿主提供的反馈能力和 UI 组件。 */
  readonly ui: PowerRendererUi;
  /** 当前展示的能力。 */
  readonly capability: WebConfiguredCapability;
}

/** 渲染一个能力的配置与状态。 */
export function WebCapabilityView({ power, ui, capability }: WebCapabilityViewProps) {
  const {
    Button, Callout, EmptyState, Group, Inline, Input, Link, LoadingState, Page, Row, Section,
    Status, Switch, Toolbar,
  } = ui.components;
  const [snapshot, set_snapshot] = useState<WebMainviewSnapshot>();
  const [sessions, set_sessions] = useState<WebMainviewSessionsResult>();
  const [draft, set_draft] = useState<CapabilityDraft>();
  const [loading, set_loading] = useState(true);
  const [saving, set_saving] = useState(false);
  const [testing, set_testing] = useState(false);
  const [error, set_error] = useState("");
  const [test_message, set_test_message] = useState<WebConfigTestResult>();

  const load = useCallback(async () => {
    set_loading(true);
    set_error("");
    try {
      const next = await power.invoke<WebMainviewSnapshot>("web.snapshot");
      set_snapshot(next);
      set_draft(draft_from(next.config));
      set_sessions(capability === "browser"
        ? await power.invoke<WebMainviewSessionsResult>("web.sessions")
        : undefined);
    } catch (reason) {
      set_error(to_error_message(reason));
    } finally {
      set_loading(false);
    }
  }, [capability, power]);
  useEffect(() => { void load(); }, [load, ui.revision]);

  const update = <TKey extends keyof CapabilityDraft>(
    key: TKey,
    value: CapabilityDraft[TKey],
  ) => set_draft((current) => current ? { ...current, [key]: value } : current);

  /** 组装本能力的字段级增量。 */
  const build_patch = (): WebConfigPatch => {
    const current = draft as CapabilityDraft;
    if (capability === "search") {
      return {
        tavily_api_key: current.tavily_api_key,
        clear_tavily_api_key: current.clear_tavily_api_key,
        exa_api_key: current.exa_api_key,
        clear_exa_api_key: current.clear_exa_api_key,
      };
    }
    if (capability === "document") {
      return {
        firecrawl_api_key: current.firecrawl_api_key,
        clear_firecrawl_api_key: current.clear_firecrawl_api_key,
      };
    }
    return {
      cdp_url: current.cdp_url,
      browser_executable_path: current.browser_executable_path,
      default_url: current.default_url,
    };
  };

  const save = async (): Promise<boolean> => {
    set_saving(true);
    set_error("");
    set_test_message(undefined);
    try {
      await power.invoke("web.config.save", to_config_patch_json(build_patch()));
      ui.toast({ type: "success", message: "Web 配置已保存" });
      ui.invalidate();
      return true;
    } catch (reason) {
      const message = to_error_message(reason);
      set_error(message);
      ui.toast({ type: "error", message });
      return false;
    } finally {
      set_saving(false);
    }
  };

  const test = async () => {
    if (!await save()) return;
    set_testing(true);
    try {
      set_test_message(await power.invoke<WebConfigTestResult>("web.config.test", { capability }));
    } catch (reason) {
      set_test_message({ success: false, message: to_error_message(reason) });
    } finally {
      set_testing(false);
    }
  };

  /**
   * 打开或关闭这个能力。
   *
   * 关闭只写 `disabled`；重新开启回到该能力的默认 Provider，而不是某个可能已经不存在的旧值。
   * 开关立即生效，因此它不走「保存」按钮——它本身就是一个完整动作。
   */
  const toggle_enabled = async (checked: boolean) => {
    set_saving(true);
    set_error("");
    try {
      await power.invoke("web.config.save", to_config_patch_json({
        [PROVIDER_FIELD[capability]]: checked ? DEFAULT_PROVIDER[capability] : "disabled",
      }));
      ui.toast({ type: "success", message: checked ? "已开启" : "已关闭" });
      ui.invalidate();
    } catch (reason) {
      const message = to_error_message(reason);
      set_error(message);
      ui.toast({ type: "error", message });
    } finally {
      set_saving(false);
    }
  };

  /**
   * 打开服务商控制台。
   *
   * 只传凭据项，不传 URL：地址属于 Power 的领域知识，集中在 host action 里定义，
   * 渲染层不能借这个动作打开任意地址。
   */
  const open_console = async (target: WebCredentialTarget) => {
    try {
      const result = await power.invoke<WebConfigTestResult>("web.config.open_console", { target });
      if (!result.success) ui.toast({ type: "error", message: result.message });
    } catch (reason) {
      ui.toast({ type: "error", message: to_error_message(reason) });
    }
  };

  const meta = CAPABILITY_ORDER.find((item) => item.key === capability);
  if (loading && !snapshot) return <LoadingState label="正在读取 Web 配置…" />;
  if (!snapshot || !draft) return <Page><Callout tone="danger">{error || "无法读取 Web 配置"}</Callout></Page>;

  const config = snapshot.config;
  const enabled = is_capability_enabled(config, capability);
  const show_tavily = capability === "search" && show_search_key(config.search_provider, "tavily");
  const show_exa = capability === "search" && show_search_key(config.search_provider, "exa");
  const show_firecrawl = capability === "document" && config.document_provider === "firecrawl";
  const show_cdp = capability === "browser" && config.browser_provider === "cdp";

  return <Page>
    {error ? <Callout tone="danger">{error}</Callout> : null}
    <Toolbar
      title={meta?.label ?? capability}
      // 用工具栏说明回答「现在是什么状态」，不再单开一个分区。
      description={capability_description(snapshot[capability])}
      actions={<Inline>
        <Switch
          checked={enabled}
          disabled={saving}
          aria_label={`${meta?.label ?? capability}开关`}
          on_checked_change={(checked) => void toggle_enabled(checked)}
        />
        <Button disabled={saving || testing || !enabled} on_click={() => void test()}>{testing ? "测试中…" : "测试"}</Button>
        <Button variant="primary" disabled={saving || testing} on_click={() => void save()}>{saving ? "保存中…" : "保存"}</Button>
      </Inline>}
    />
    {test_message ? <Status tone={test_message.success ? "success" : "danger"}>{test_message.message}</Status> : null}
    {snapshot.warnings.length ? <Callout tone="warning">{snapshot.warnings.join("；")}</Callout> : null}

    {enabled ? <Section title="参数">
      <Group>
        {show_tavily ? <WebSecretRow
          label="Tavily API Key"
          configured={config.tavily_api_key_configured}
          value={draft.tavily_api_key}
          cleared={draft.clear_tavily_api_key}
          set_value={(value) => update("tavily_api_key", value)}
          clear={() => update("clear_tavily_api_key", true)}
          restore={() => update("clear_tavily_api_key", false)}
          target="tavily_api_key"
          on_open_console={(target) => void open_console(target)}
          components={ui.components}
        /> : null}
        {show_exa ? <WebSecretRow
          label="Exa API Key"
          configured={config.exa_api_key_configured}
          value={draft.exa_api_key}
          cleared={draft.clear_exa_api_key}
          set_value={(value) => update("exa_api_key", value)}
          clear={() => update("clear_exa_api_key", true)}
          restore={() => update("clear_exa_api_key", false)}
          target="exa_api_key"
          on_open_console={(target) => void open_console(target)}
          components={ui.components}
        /> : null}
        {show_firecrawl ? <WebSecretRow
          label="Firecrawl API Key"
          configured={config.firecrawl_api_key_configured}
          value={draft.firecrawl_api_key}
          cleared={draft.clear_firecrawl_api_key}
          set_value={(value) => update("firecrawl_api_key", value)}
          clear={() => update("clear_firecrawl_api_key", true)}
          restore={() => update("clear_firecrawl_api_key", false)}
          target="firecrawl_api_key"
          on_open_console={(target) => void open_console(target)}
          components={ui.components}
        /> : null}
        {show_cdp ? <Row
          label="CDP endpoint"
          description="远程浏览器的调试地址；把地址和端口拼成 http://host:port 即可。"
          trailing={<Inline>
            <Input
              fill
              value={draft.cdp_url}
              on_value_change={(value) => update("cdp_url", value)}
              placeholder="远程浏览器的调试地址"
            />
            <Link external on_click={() => void open_console("cdp_url")}>调试文档</Link>
          </Inline>}
        /> : null}
        {capability === "browser" ? <Row
          label="Chrome 路径"
          trailing={<Input
            fill
            value={draft.browser_executable_path}
            on_value_change={(value) => update("browser_executable_path", value)}
            placeholder="留空自动发现"
          />}
        /> : null}
        {capability === "browser" ? <Row
          label="默认 URL"
          trailing={<Input
            fill
            value={draft.default_url}
            on_value_change={(value) => update("default_url", value)}
            placeholder="about:blank"
          />}
        /> : null}
      </Group>
    </Section> : <Callout>已关闭。打开开关后，这个能力才会解析 Provider 并可用。</Callout>}

    {capability === "browser" && enabled ? <Section title="浏览器会话">
      {!sessions?.available ? <EmptyState title="浏览器能力不可用" description={sessions?.note} size="compact" />
        : !sessions.sessions.length ? <EmptyState title="当前没有活跃会话" description={sessions.note} size="compact" />
          : <Group>{sessions.sessions.map((session) => <Row
            key={session.session_id}
            label={session.title || session.url || "未命名页面"}
            description={session.url}
            trailing={<Status>{`第 ${session.observation_generation} 代`}</Status>}
          />)}</Group>}
    </Section> : null}
  </Page>;
}
