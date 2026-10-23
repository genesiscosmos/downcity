/** MCP Power 的 Desktop Config Renderer。 */

import { useCallback, useEffect, useState } from "react";
import { define_power_renderer } from "@downcity/city/power/react";
import type { McpPowerConfig, McpServerConfig, McpServerStatus } from "@/mcp/types/McpPower.js";
import type { PowerRendererUiComponents } from "@downcity/city/power/react";

interface McpConfigView {
  /** 脱敏后的 server 配置。 */
  servers: McpServerConfig[];
}

interface McpStatusView {
  /** server 运行状态。 */
  servers: McpServerStatus[];
}

/** MCP Power Renderer 定义。 */
export const MCP_POWER_RENDERER = define_power_renderer({
  sidebar: function McpPowerSidebar({ power, ui }) {
    const { Callout, LoadingState, Sidebar, SidebarSection, SidebarTreeItem, Status } = ui.components;
    const [status, set_status] = useState<McpStatusView>();
    const [error, set_error] = useState("");
    const load = useCallback(async () => {
      try {
        set_status(await power.invoke<McpStatusView>("mcp.status"));
        set_error("");
      } catch (reason) {
        set_error(to_error_message(reason));
      }
    }, [power]);
    useEffect(() => { void load(); }, [load, ui.revision]);
    if (!status) return <Sidebar>{error ? <Callout tone="danger">{error}</Callout> : <LoadingState label="正在读取 MCP 状态…" />}</Sidebar>;
    return <Sidebar>
      <SidebarSection label="MCP Servers">
        {status.servers.length === 0 ? <Callout tone="default">尚未配置 MCP Server</Callout> : status.servers.map((server) => <SidebarTreeItem
          key={server.id}
          kind="leaf"
          depth={0}
          label={server.id}
          trailing={<Status tone={server.state === "ready" ? "success" : server.state === "error" ? "danger" : "warning"}>{`${server.state} · ${server.tool_count}`}</Status>}
          on_select={() => undefined}
        />)}
      </SidebarSection>
    </Sidebar>;
  },
  mainview: function McpPowerMainview({ power, ui }) {
    const { Callout, Group, LoadingState, Page, Row, Section, Toolbar, Button, Status } = ui.components;
    const [status, set_status] = useState<McpStatusView>();
    const [error, set_error] = useState("");
    const load = useCallback(async () => {
      try {
        set_status(await power.invoke<McpStatusView>("mcp.status"));
        set_error("");
      } catch (reason) {
        set_error(to_error_message(reason));
      }
    }, [power]);
    useEffect(() => { void load(); }, [load, ui.revision]);
    if (!status) return <LoadingState label="正在读取 MCP 状态…" />;
    return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar title="MCP" description="管理外部 MCP Server 的连接状态和工具面。" actions={<Button on_click={() => void load()}>刷新</Button>} />
      <Callout tone="default">通过 mcp.servers、mcp.tools 和 mcp.call 发现与调用工具。已启用 Server 的调用直接执行，描述和结果作为外部数据处理。</Callout>
      <Section title="连接状态">
        {status.servers.length === 0 ? <Group><Row label="暂无配置的 MCP Server" /></Group> : status.servers.map((server) => <Group key={server.id} label={server.id}>
          <Row label="状态" trailing={<Status tone={server.state === "ready" ? "success" : server.state === "error" ? "danger" : "warning"}>{server.state}</Status>} />
          <Row label="工具数量" trailing={<span>{String(server.tool_count)}</span>} />
          {server.last_error ? <Row label="最近错误" trailing={<span>{server.last_error}</span>} /> : null}
          {server.updated_at ? <Row label="更新时间" trailing={<span>{server.updated_at}</span>} /> : null}
        </Group>)}
      </Section>
    </Page>;
  },
  config: function McpPowerConfigView({ config, ui }) {
    const { Button, Callout, Group, Input, LoadingState, Page, Row, Section, Select, Switch, Textarea, Toolbar } = ui.components;
    const [draft, set_draft] = useState<McpPowerConfig>({ servers: [] });
    const [status, set_status] = useState<McpStatusView>({ servers: [] });
    const [loading, set_loading] = useState(true);
    const [saving, set_saving] = useState(false);
    const [error, set_error] = useState("");

    const load = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        const [next, next_status] = await Promise.all([
          config.invoke<McpConfigView>("mcp.config.read"),
          config.invoke<{ servers: McpServerStatus[] }>("mcp.config.status").catch(() => ({ servers: [] })),
        ]);
        set_draft({ servers: next.servers.map(normalize_server) });
        set_status(next_status);
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_loading(false);
      }
    }, [config]);
    useEffect(() => { void load(); }, [load]);

    const update_server = (index: number, patch: Partial<McpServerConfig>) => {
      set_draft((current) => ({
        servers: current.servers.map((server, server_index) => server_index === index ? { ...server, ...patch } : server),
      }));
    };
    const add_server = () => set_draft((current) => ({
      servers: [...current.servers, create_default_server(current.servers)],
    }));
    const remove_server = (index: number) => set_draft((current) => ({
      servers: current.servers.filter((_server, server_index) => server_index !== index),
    }));
    const save = async () => {
      set_saving(true);
      set_error("");
      try {
        await config.invoke("mcp.config.save", draft as unknown as import("@downcity/city/power").PowerJsonValue);
        ui.toast({ type: "success", message: "MCP 配置已保存" });
        ui.invalidate();
        await load();
      } catch (reason) {
        const message = to_error_message(reason);
        set_error(message);
        ui.toast({ type: "error", message });
      } finally {
        set_saving(false);
      }
    };
    const test = async (server_id: string) => {
      try {
        const result = await config.invoke<{ tool_count: number; tools: string[] }>("mcp.config.test", { server_id });
        ui.toast({ type: "success", message: `${server_id}: ${result.tool_count} 个工具` });
      } catch (reason) {
        ui.toast({ type: "error", message: to_error_message(reason) });
      }
    };
    const reload = async (server_id: string) => {
      try {
        await config.invoke("mcp.config.reload", { server_id });
        ui.toast({ type: "success", message: `${server_id} 已重载` });
        await load();
      } catch (reason) {
        ui.toast({ type: "error", message: to_error_message(reason) });
      }
    };

    if (loading) return <LoadingState label="正在读取 MCP 配置…" />;
    return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar title="MCP Servers" description="配置外部 MCP Server，并将其工具提供给 Agent。" actions={<Button variant="primary" disabled={saving} on_click={() => void save()}>{saving ? "保存中…" : "保存"}</Button>} />
      <Callout tone="warning">stdio Server 会在本机执行任意代码。只配置可信来源；Server 返回的工具描述和结果都按外部数据处理。</Callout>
      <Section title="Servers" action={<Button on_click={add_server}>添加 Server</Button>}>
        {draft.servers.map((server, index) => {
          const server_status = status.servers.find((item) => item.id === server.id);
          return <Group key={`${server.id}-${index}`} label={server.title || server.id || "新 Server"}>
            <Row label="启用" trailing={<Switch aria_label={`启用 ${server.id || "MCP Server"}`} checked={server.enabled} on_checked_change={(checked) => update_server(index, { enabled: checked })} />} />
            <Row label="ID" trailing={<Input value={server.id} on_value_change={(value) => update_server(index, { id: value })} />} />
            <Row label="标题" trailing={<Input value={server.title || ""} on_value_change={(value) => update_server(index, { title: value })} />} />
            <Row label="传输" trailing={<Select value={server.transport.type} options={[{ value: "stdio", label: "stdio" }, { value: "http", label: "Streamable HTTP" }]} on_value_change={(value) => update_server(index, { transport: value === "http" ? { type: "http", url: "" } : { type: "stdio", command: "" } })} />} />
            {server.transport.type === "stdio"
              ? <>
                <Row label="命令" trailing={<Input value={server.transport.command} on_value_change={(value) => update_server(index, { transport: { type: "stdio", command: value, args: server.transport.type === "stdio" ? server.transport.args : undefined, env: server.transport.type === "stdio" ? server.transport.env : undefined, cwd: server.transport.type === "stdio" ? server.transport.cwd : undefined } })} />} />
                <Row label="参数" trailing={<Textarea value={(server.transport.type === "stdio" ? server.transport.args : [])?.join("\n") || ""} on_value_change={(value) => update_server(index, { transport: { type: "stdio", command: server.transport.type === "stdio" ? server.transport.command : "", args: value.split("\n").filter(Boolean), env: server.transport.type === "stdio" ? server.transport.env : undefined, cwd: server.transport.type === "stdio" ? server.transport.cwd : undefined } })} />} />
                <Row label="工作目录" trailing={<Input value={server.transport.type === "stdio" ? server.transport.cwd || "" : ""} on_value_change={(value) => update_server(index, { transport: { type: "stdio", command: server.transport.type === "stdio" ? server.transport.command : "", args: server.transport.type === "stdio" ? server.transport.args : undefined, env: server.transport.type === "stdio" ? server.transport.env : undefined, cwd: value } })} />} />
              </>
              : <>
                <Row label="URL" trailing={<Input value={server.transport.type === "http" ? server.transport.url : ""} on_value_change={(value) => update_server(index, { transport: { type: "http", url: value, headers: server.transport.type === "http" ? server.transport.headers : undefined } })} />} />
                <Row label="Headers" trailing={<Textarea value={format_headers(server.transport.type === "http" ? server.transport.headers : undefined)} on_value_change={(value) => update_server(index, { transport: { type: "http", url: server.transport.type === "http" ? server.transport.url : "", headers: parse_headers(value) } })} />} />
              </>}
            <Row label="信任级别" trailing={<Select value={server.trust} options={[{ value: "untrusted", label: "不可信来源" }, { value: "trusted", label: "可信来源" }]} on_value_change={(value) => update_server(index, { trust: value as McpServerConfig["trust"] })} />} />
            <Row label="调用超时（ms）" trailing={<Input type="number" value={String(server.request_timeout_ms)} on_value_change={(value) => update_server(index, { request_timeout_ms: Number(value) || 60000 })} />} />
            <Row label="结果上限" trailing={<Input type="number" value={String(server.max_result_chars)} on_value_change={(value) => update_server(index, { max_result_chars: Number(value) || 100000 })} />} />
            <Row label={server_status ? `状态：${server_status.state}，工具 ${server_status.tool_count}` : "尚未连接"} trailing={<InlineActions Button={Button} on_test={() => void test(server.id)} on_reload={() => void reload(server.id)} on_remove={() => remove_server(index)} />} />
          </Group>;
        })}
      </Section>
    </Page>;
  },
});

function InlineActions({ Button, on_test, on_reload, on_remove }: { Button: PowerRendererUiComponents["Button"]; on_test: () => void; on_reload: () => void; on_remove: () => void }) {
  return <span><Button on_click={on_test}>测试</Button><Button on_click={on_reload}>重载</Button><Button variant="destructive" on_click={on_remove}>删除</Button></span>;
}

function normalize_server(server: McpServerConfig): McpServerConfig {
  return { ...server, title: server.title || "", disabled_tools: server.disabled_tools || [], attach_media: Boolean(server.attach_media) };
}
function create_default_server(servers: readonly McpServerConfig[]): McpServerConfig {
  let id = "server";
  let suffix = 2;
  while (servers.some((server) => server.id === id)) id = `server_${suffix++}`;
  return { id, title: "", enabled: true, transport: { type: "stdio", command: "" }, trust: "untrusted", request_timeout_ms: 60000, idle_timeout_ms: 0, max_result_chars: 100000, disabled_tools: [], attach_media: false };
}
function format_headers(headers?: Record<string, string>): string { return Object.entries(headers || {}).map(([key, value]) => `${key}: ${value}`).join("\n"); }
function parse_headers(value: string): Record<string, string> { return Object.fromEntries(value.split("\n").map((line) => line.split(/:\s*/, 2)).filter(([key, item]) => Boolean(key && item))); }
function to_error_message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
