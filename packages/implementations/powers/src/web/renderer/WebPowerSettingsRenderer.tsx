/** Web Power 的 Desktop 配置界面。 */

import { useCallback, useEffect, useState } from "react";
import { define_power_renderer } from "@downcity/city/power/react";
import type {
  WebPowerConfigDraft,
  WebPowerConfigTestResult,
  WebPowerConfigView,
} from "@/web/types/WebPowerSettings.js";

/** Web Power 专用配置 Renderer。 */
export const WEB_POWER_RENDERER = define_power_renderer({
  config: function WebPowerSettingsRenderer({ config, ui }) {
    const {
      Button, Callout, Group, Inline, Input, LoadingState, Page, Row, Select,
      Stack, Status, Toolbar,
    } = ui.components;
    const [draft, set_draft] = useState<WebPowerConfigDraft>();
    const [loading, set_loading] = useState(true);
    const [saving, set_saving] = useState(false);
    const [testing, set_testing] = useState<"search" | "document" | "browser">();
    const [error, set_error] = useState("");
    const [test_message, set_test_message] = useState<WebPowerConfigTestResult>();

    const load = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        set_draft(to_draft(await config.invoke<WebPowerConfigView>("config.read")));
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_loading(false);
      }
    }, [config]);
    useEffect(() => { void load(); }, [load]);

    const update = <TKey extends keyof WebPowerConfigDraft>(
      key: TKey,
      value: WebPowerConfigDraft[TKey],
    ) => set_draft((current) => current ? { ...current, [key]: value } : current);

    const save = async (): Promise<boolean> => {
      if (!draft) return false;
      set_saving(true);
      set_error("");
      set_test_message(undefined);
      try {
        const saved = await config.invoke<WebPowerConfigView>("config.save", draft);
        set_draft(to_draft(saved));
        ui.toast({ type: "success", message: "Web 配置已保存" });
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

    const test = async (capability: "search" | "document" | "browser") => {
      if (!await save()) return;
      set_testing(capability);
      try {
        const result = await config.invoke<WebPowerConfigTestResult>("config.test", { capability });
        set_test_message(result);
      } catch (reason) {
        set_test_message({ success: false, message: to_error_message(reason) });
      } finally {
        set_testing(undefined);
      }
    };

    if (loading && !draft) return <LoadingState label="正在读取 Web 配置…" />;
    if (!draft) return <Callout tone="danger">{error || "无法读取 Web 配置"}</Callout>;

    return <Page>
      <Toolbar
        title="Web 联网能力"
        description="静态读取默认可用；搜索按需配置服务，浏览器默认自动启动本地 Chrome。"
        actions={<Button variant="primary" disabled={saving || Boolean(testing)} on_click={() => void save()}>{saving ? "保存中…" : "保存"}</Button>}
      />
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {test_message ? <Status tone={test_message.success ? "success" : "danger"}>{test_message.message}</Status> : null}
      <Callout tone="warning">API Key 会写入 Downcity 本地 Power 配置文件，不会回显到界面；当前尚未使用系统钥匙串。</Callout>
      <Stack>
        <Group label="搜索">
          <Row label="Search provider" description="Auto 会优先使用已配置的 Tavily，其次 Exa。" trailing={<Select value={draft.search_provider} options={[
            { value: "auto", label: "Auto" },
            { value: "tavily", label: "Tavily" },
            { value: "exa", label: "Exa" },
            { value: "disabled", label: "关闭" },
          ]} on_value_change={(value) => update("search_provider", value as WebPowerConfigDraft["search_provider"])} />} />
          <SecretRow label="Tavily API Key" configured={draft.tavily_api_key_configured} value={draft.tavily_api_key} cleared={draft.clear_tavily_api_key} set_value={(value) => update("tavily_api_key", value)} clear={() => update("clear_tavily_api_key", true)} restore={() => update("clear_tavily_api_key", false)} components={{ Button, Inline, Input, Row, Status }} />
          <SecretRow label="Exa API Key" configured={draft.exa_api_key_configured} value={draft.exa_api_key} cleared={draft.clear_exa_api_key} set_value={(value) => update("exa_api_key", value)} clear={() => update("clear_exa_api_key", true)} restore={() => update("clear_exa_api_key", false)} components={{ Button, Inline, Input, Row, Status }} />
          <Row label="测试搜索" description="保存当前配置后执行一次最小搜索。" trailing={<Button disabled={Boolean(testing)} on_click={() => void test("search")}>{testing === "search" ? "测试中…" : "测试"}</Button>} />
        </Group>

        <Group label="网页读取">
          <Row label="Document provider" description="Fetch 无需密钥；Firecrawl 适合动态或难解析页面。" trailing={<Select value={draft.document_provider} options={[
            { value: "fetch", label: "Built-in Fetch" },
            { value: "firecrawl", label: "Firecrawl" },
            { value: "disabled", label: "关闭" },
          ]} on_value_change={(value) => update("document_provider", value as WebPowerConfigDraft["document_provider"])} />} />
          <SecretRow label="Firecrawl API Key" configured={draft.firecrawl_api_key_configured} value={draft.firecrawl_api_key} cleared={draft.clear_firecrawl_api_key} set_value={(value) => update("firecrawl_api_key", value)} clear={() => update("clear_firecrawl_api_key", true)} restore={() => update("clear_firecrawl_api_key", false)} components={{ Button, Inline, Input, Row, Status }} />
          <Row label="测试网页读取" description="保存当前配置后读取 example.com。" trailing={<Button disabled={Boolean(testing)} on_click={() => void test("document")}>{testing === "document" ? "测试中…" : "测试"}</Button>} />
        </Group>

        <Group label="浏览器">
          <Row label="Browser provider" description="Local 自动启动独立 Chrome；CDP 用于云浏览器或现有端点。" trailing={<Select value={draft.browser_provider} options={[
            { value: "local", label: "Local Chrome" },
            { value: "cdp", label: "Remote CDP" },
            { value: "disabled", label: "关闭" },
          ]} on_value_change={(value) => update("browser_provider", value as WebPowerConfigDraft["browser_provider"])} />} />
          {draft.browser_provider === "cdp" ? <Row label="CDP endpoint" description="远程浏览器的 HTTP 或 WebSocket 调试地址。" trailing={<Input fill value={draft.cdp_url} on_value_change={(value) => update("cdp_url", value)} placeholder="https://…" />} /> : null}
          {draft.browser_provider === "local" ? <Row label="Chrome 路径" description="留空自动发现 Google Chrome、Chromium 或 Edge。" trailing={<Input fill value={draft.browser_executable_path} on_value_change={(value) => update("browser_executable_path", value)} placeholder="自动发现" />} /> : null}
          <Row label="默认 URL" description="创建浏览器 Session 时未指定地址才使用。" trailing={<Input fill value={draft.default_url} on_value_change={(value) => update("default_url", value)} placeholder="about:blank" />} />
          <Row label="测试浏览器" description="保存当前配置后创建并立即关闭一个 Session。" trailing={<Button disabled={Boolean(testing)} on_click={() => void test("browser")}>{testing === "browser" ? "测试中…" : "测试"}</Button>} />
        </Group>

        <Group label="高级">
          <Row label="操作超时（ms）" trailing={<Input type="number" value={String(draft.timeout_ms)} minimum={1000} maximum={60000} on_value_change={(value) => update("timeout_ms", Number(value) || 30_000)} />} />
          <Row label="观察字符上限" trailing={<Input type="number" value={String(draft.max_observation_chars)} minimum={1} maximum={100000} on_value_change={(value) => update("max_observation_chars", Number(value) || 12_000)} />} />
        </Group>
      </Stack>
    </Page>;
  },
});

/** 渲染不会回显已保存值的密钥输入行。 */
function SecretRow(props: {
  label: string;
  configured: boolean;
  value: string;
  cleared: boolean;
  set_value(value: string): void;
  clear(): void;
  restore(): void;
  components: Pick<import("@downcity/city/power/react").PowerRendererUiComponents, "Button" | "Inline" | "Input" | "Row" | "Status">;
}) {
  const { Button, Inline, Input, Row, Status } = props.components;
  const status = props.cleared
    ? <Status tone="warning">保存后清除</Status>
    : props.configured ? <Status tone="success">已配置</Status> : <Status tone="muted">未配置</Status>;
  return <Row label={props.label} trailing={<Inline>
    {status}
    <Input type="password" value={props.value} disabled={props.cleared} on_value_change={props.set_value} placeholder={props.configured ? "输入新值以替换" : "输入 API Key"} />
    {props.configured ? <Button variant={props.cleared ? "default" : "destructive"} on_click={props.cleared ? props.restore : props.clear}>{props.cleared ? "撤销" : "清除"}</Button> : null}
  </Inline>} />;
}

/** 把脱敏配置转换为可编辑状态。 */
function to_draft(config: WebPowerConfigView): WebPowerConfigDraft {
  return {
    ...config,
    tavily_api_key: "",
    exa_api_key: "",
    firecrawl_api_key: "",
    clear_tavily_api_key: false,
    clear_exa_api_key: false,
    clear_firecrawl_api_key: false,
  };
}

/** 把未知异常转换成界面文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
