/**
 * 统一 Skill Power 复用的 MCP 资源详情与配置组件。
 * 业务插槽只读取连接状态；Config 通过独立管理通道逐文件编辑原始 TOML，
 * 使用载入原文检测外部修改，并保留其他文件尚未保存的草稿。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PowerConfigComponentProps, PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { McpServerFilesView as McpConfigSnapshotView } from "@/mcp/types/McpServerFiles.js";
import type { McpStatusResult as McpRendererStatusView } from "@/mcp/types/McpPower.js";
import type {
  McpConfigEditorState,
  McpConfigFileDraft,
  McpConfigTestView,
} from "@/mcp/types/McpPowerRenderer.js";

/** MCP 资源详情输入；导航由统一 Skill Sidebar 持有。 */
export interface McpResourceDetailProps extends PowerMainviewComponentProps {
  /** 当前选中的全局 MCP Server ID。 */
  readonly server_id: string;
}

/** MCP 配置编辑器输入，可限制为单个资源。 */
export interface McpResourceConfigProps extends PowerConfigComponentProps {
  /** 仅展示该 Server 的配置；省略时管理全部文件。 */
  readonly server_id?: string;
}

/** Safe tool metadata returned by the Skill host management action. */
interface McpToolsView {
  /** Selected global Server identifier. */
  readonly server_id: string;
  /** Discovered tools with JSON schemas, without invoking those tools. */
  readonly tools: Array<{
    /** Exact MCP tool identifier. */
    readonly name: string;
    /** Human-readable purpose supplied by the server. */
    readonly description: string;
    /** JSON input schema expected by the server. */
    readonly input_schema: Record<string, unknown>;
  }>;
}

/** 展示单个 MCP Server 的连接、授权与工具状态。 */
export function mcp_resource_detail({ power, ui, server_id }: McpResourceDetailProps) {
    const { Button, Callout, CodeBlock, EmptyState, Group, LoadingState, Page, Row, Section, Status, Toolbar } = ui.components;
    const [status, set_status] = useState<McpRendererStatusView>();
    const [error, set_error] = useState("");
    const [tools, set_tools] = useState<McpToolsView>();
    const [discovering, set_discovering] = useState(false);
    const [refreshing, set_refreshing] = useState(false);
    const discover_tools = async () => {
      set_discovering(true);
      set_error("");
      try {
        set_tools(await power.invoke<McpToolsView>("skill.mcp.tools", { server_id }));
        ui.invalidate();
      } catch (reason) { set_error(to_error_message(reason)); }
      finally { set_discovering(false); }
    };
    const [authorizing, set_authorizing] = useState<string[]>([]);
    useEffect(() => {
      let disposed = false;
      const timer = setInterval(() => {
        void power.invoke<McpRendererStatusView>("skill.mcp.status").then((next) => { if (!disposed) set_status(next); }).catch(() => undefined);
      }, 1500);
      return () => { disposed = true; clearInterval(timer); };
    }, [power]);
    const authorize = async (server_id: string, cancel = false) => {
      set_authorizing((current) => [...current, server_id]);
      try {
        set_status(await power.invoke<McpRendererStatusView>(cancel ? "skill.mcp.cancel_authorization" : "skill.mcp.reauthorize", { server_id }));
        set_error("");
      } catch (reason) { set_error(to_error_message(reason)); }
      finally { set_authorizing((current) => current.filter((id) => id !== server_id)); }
    };
    const request_sequence = useRef(0);
    useEffect(() => {
      const sequence = ++request_sequence.current;
      void power.invoke<McpRendererStatusView>("skill.mcp.status")
        .then((next) => { if (sequence === request_sequence.current) { set_status(next); set_error(""); } })
        .catch((reason: unknown) => { if (sequence === request_sequence.current) set_error(to_error_message(reason)); });
      return () => { request_sequence.current++; };
    }, [power, ui.revision]);
    const refresh = async () => {
      const sequence = ++request_sequence.current;
      set_refreshing(true);
      set_error("");
      try {
        const next = await power.invoke<McpRendererStatusView>("skill.mcp.refresh");
        if (sequence === request_sequence.current) set_status(next);
        ui.invalidate();
      } catch (reason) {
        if (sequence === request_sequence.current) set_error(to_error_message(reason));
      } finally {
        set_refreshing(false);
      }
    };
    return <Page>
      <Toolbar title={server_id} description="MCP Server 连接状态和工具。" actions={<Button disabled={refreshing} on_click={() => void refresh()}>{refreshing ? "刷新中…" : "刷新连接"}</Button>} />
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {!status && !error ? <LoadingState label="正在读取 MCP 状态…" /> : null}
      <Callout tone="default">保存配置不会启动 Server，idle 表示尚未连接。刷新连接会重新扫描文件并重连；首次发现或调用工具也会连接。</Callout>
      {status ? <>
        <Group><Row label="配置目录" description={status.directory} /></Group>
        <Section title="连接状态">
          {status.servers.length === 0 ? <Group><Row label="暂无配置的 MCP Server" /></Group> : status.servers.filter((server) => server.id === server_id).map((server) => <Group key={server.id} label={server.id}>
            <Row label="状态" trailing={<Status tone={server.state === "ready" ? "success" : server.state === "error" ? "danger" : "warning"}>{server.state}</Status>} />
            <Row label="工具数量" trailing={<span>{String(server.tool_count)}</span>} />
            {server.can_authorize ? <Row label="OAuth" description={server.auth_state ?? "none"} trailing={<span>
              <Button disabled={authorizing.includes(server.id) || server.auth_state === "authorizing" || server.state === "disabled"} on_click={() => void authorize(server.id)}>重新授权</Button>
              {server.auth_state === "authorizing" ? <Button on_click={() => void authorize(server.id, true)}>取消授权</Button> : null}
            </span>} /> : null}
            {server.last_error ? <Row label="最近错误" description={server.last_error} /> : null}
            {server.updated_at ? <Row label="更新时间" description={server.updated_at} /> : null}
          </Group>)}
        </Section>
        {!status.servers.some((server) => server.id === server_id) ? <EmptyState title="MCP Server 已不存在" /> : <Section title="工具" action={<Button disabled={discovering} on_click={() => void discover_tools()}>{discovering ? "正在发现…" : "发现工具"}</Button>}>
          {tools?.server_id === server_id ? tools.tools.length ? tools.tools.map((tool) => <Group key={tool.name} label={tool.name}>
            <Row label={tool.name} description={tool.description} />
            <CodeBlock>{JSON.stringify(tool.input_schema, null, 2)}</CodeBlock>
          </Group>) : <EmptyState title="Server 未提供工具" size="compact" /> : <Callout>发现工具会连接此 Server 并读取工具说明。</Callout>}
        </Section>}
      </> : null}
    </Page>;
  }

/** 编辑 MCP 原始文件，保留独立文件草稿和并发修改检查。 */
export function mcp_resource_config({ config, ui, server_id }: McpResourceConfigProps) {
    const { Button, Callout, Field, Group, Input, LoadingState, Page, Row, Section, Textarea, Toolbar } = ui.components;
    const [editor, set_editor] = useState<McpConfigEditorState>({ directory: "", drafts: [] });
    const [loading, set_loading] = useState(true);
    const [busy, set_busy] = useState("");
    const busy_ref = useRef(false);
    const [error, set_error] = useState("");
    const [delete_id, set_delete_id] = useState<string>();
    const draft_sequence = useRef(0);

    const apply_snapshot = useCallback((snapshot: McpConfigSnapshotView, replace_id?: string) => {
      set_editor((current) => ({
        directory: snapshot.directory,
        drafts: merge_snapshot(current.drafts, snapshot, replace_id),
      }));
    }, []);
    useEffect(() => {
      let disposed = false;
      set_loading(true);
      void config.invoke<McpConfigSnapshotView>("skill.mcp.config.read")
        .then((snapshot) => { if (!disposed) { apply_snapshot(snapshot); set_error(""); } })
        .catch((reason: unknown) => { if (!disposed) set_error(to_error_message(reason)); })
        .finally(() => { if (!disposed) set_loading(false); });
      return () => { disposed = true; };
    }, [apply_snapshot, config]);

    const update_content = (draft_key: string, content: string) => set_editor((current) => ({
      ...current,
      drafts: current.drafts.map((draft) => draft.draft_key === draft_key ? { ...draft, content } : draft),
    }));
    // 管理动作串行执行，避免较早返回的目录快照覆盖较新的操作结果。
    const run_operation = async (operation_id: string, server_id: string | undefined, operation: () => Promise<void>) => {
      if (busy_ref.current) return;
      busy_ref.current = true;
      set_busy(operation_id);
      set_error("");
      if (server_id) set_editor((current) => ({ ...current, drafts: current.drafts.map((draft) => draft.id === server_id ? { ...draft, operation_error: undefined } : draft) }));
      try {
        await operation();
      } catch (reason) {
        const message = to_error_message(reason);
        if (server_id) set_editor((current) => ({ ...current, drafts: current.drafts.map((draft) => draft.id === server_id ? { ...draft, operation_error: message } : draft) }));
        else set_error(message);
      } finally {
        busy_ref.current = false;
        set_busy("");
      }
    };
    const save_file = (draft: McpConfigFileDraft) => run_operation(`save:${draft.id}`, draft.id, async () => {
      const snapshot = await config.invoke<McpConfigSnapshotView>("skill.mcp.config.save", {
        server_id: draft.id,
        content: draft.content,
        ...(draft.create ? { create: true } : { expected_content: draft.original_content }),
      });
      apply_snapshot(snapshot, draft.id);
      ui.invalidate();
      ui.toast({ type: "success", message: `${draft.id} 已保存` });
    });
    const remove_file = (draft: McpConfigFileDraft) => run_operation(`remove:${draft.id}`, draft.id, async () => {
      const snapshot = await config.invoke<McpConfigSnapshotView>("skill.mcp.config.remove", {
        server_id: draft.id, expected_content: draft.original_content,
      });
      apply_snapshot(snapshot, draft.id);
      set_delete_id(undefined);
      ui.invalidate();
      ui.toast({ type: "success", message: `${draft.id} 已删除` });
    });
    const reread_file = (draft: McpConfigFileDraft) => run_operation(`read:${draft.id}`, draft.id, async () => {
      if (draft.content !== draft.original_content && !await ui.confirm({ title: `重新读取 ${draft.id}`, description: "将丢弃该文件的未保存内容，并读取磁盘上的最新原文。", action: "重新读取" })) return;
      apply_snapshot(await config.invoke<McpConfigSnapshotView>("skill.mcp.config.read"), draft.id);
    });
    const test_file = (draft: McpConfigFileDraft) => run_operation(`test:${draft.id}`, draft.id, async () => {
      const result = await config.invoke<McpConfigTestView>("skill.mcp.config.test", { server_id: draft.id });
      ui.toast({ type: "success", message: `${draft.id}: ${result.tool_count} 个工具` });
    });
    const reload = () => run_operation("reload", undefined, async () => {
      apply_snapshot(await config.invoke<McpConfigSnapshotView>("skill.mcp.config.reload"));
      ui.invalidate();
      ui.toast({ type: "success", message: "已重新扫描配置并刷新连接" });
    });
    const add_server = () => {
      const draft_key = `new:${++draft_sequence.current}`;
      set_editor((current) => {
      let server_id = "server";
      let suffix = 2;
      while (current.drafts.some((draft) => draft.id === server_id)) server_id = `server_${suffix++}`;
      return { ...current, drafts: [...current.drafts, {
        draft_key, id: server_id, path: "", content: DEFAULT_SERVER_CONTENT, original_content: "", create: true,
      }] };
      });
    };

    if (loading) return <LoadingState label="正在读取 MCP 配置…" />;
    return <Page>
      <Toolbar title="MCP Servers" description="每个 Server 使用一个 TOML 文件，分别保存和删除。" actions={<span>
        <Button disabled={Boolean(busy)} on_click={() => void run_operation("read", undefined, async () => {
          apply_snapshot(await config.invoke<McpConfigSnapshotView>("skill.mcp.config.read"));
        })}>{busy === "read" ? "读取中…" : "重新扫描文件"}</Button>
        <Button disabled={Boolean(busy)} on_click={() => void reload()}>{busy === "reload" ? "刷新中…" : "刷新连接"}</Button>
      </span>} />
      <Callout tone="default">读取、创建和保存文件均不会启动 Server，保存后 idle 属于正常状态。重新扫描文件会保留未保存草稿；重新读取单个文件会替换该草稿。刷新连接会重扫并重连已保存的配置，测试也使用已保存文件。stdio 请填写已安装的可执行程序路径。</Callout>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {editor.directory ? <Group><Row label="配置目录" description={editor.directory} /></Group> : null}
      <Section title="Server 文件" action={!server_id ? <Button disabled={Boolean(busy) || !editor.directory} on_click={add_server}>新建 Server</Button> : undefined}>
        {editor.drafts.length === 0 ? <Callout tone="default">尚无 Server 文件。</Callout> : null}
        {editor.drafts.filter((draft) => !server_id || draft.id === server_id).map((draft) => <Group key={draft.draft_key} label={draft.id}>
          {draft.create ? <Field label="Server ID" description="保存后以该 ID 创建独立 TOML 文件。">
            <Input value={draft.id} disabled={Boolean(busy)} on_value_change={(value) => {
              set_editor((current) => ({ ...current, drafts: current.drafts.map((item) => item.draft_key === draft.draft_key ? { ...item, id: value } : item) }));
            }} />
          </Field> : <Row label="文件路径" description={draft.path} />}
          {draft.error ? <Callout tone="danger">{draft.error}</Callout> : null}
          {draft.operation_error ? <Callout tone="danger">{draft.operation_error}</Callout> : null}
          <Field label="TOML" description={draft.create || draft.content !== draft.original_content ? "未保存" : "已载入文件原文"}>
            <Textarea value={draft.content} rows={14} disabled={Boolean(busy)} on_value_change={(value) => update_content(draft.draft_key, value)} />
          </Field>
          <Row label="文件操作" trailing={<span>
            <Button variant="primary" disabled={Boolean(busy) || !draft.id.trim() || editor.drafts.some((item) => item !== draft && item.id === draft.id) || (!draft.create && draft.content === draft.original_content)} on_click={() => void save_file(draft)}>{busy === `save:${draft.id}` ? "保存中…" : draft.create ? "创建文件" : "保存文件"}</Button>
            {!draft.create ? <>
              <Button disabled={Boolean(busy)} on_click={() => void reread_file(draft)}>重新读取</Button>
              <Button disabled={Boolean(busy)} on_click={() => void test_file(draft)}>测试已保存文件</Button>
            </> : null}
            <Button variant="destructive" disabled={Boolean(busy)} on_click={() => {
              if (draft.create) set_editor((current) => ({ ...current, drafts: current.drafts.filter((item) => item !== draft) }));
              else set_delete_id(draft.id);
            }}>{draft.create ? "丢弃草稿" : "删除"}</Button>
          </span>} />
          {delete_id === draft.id && !draft.create ? <Row label="确认删除这个 Server 文件？" trailing={<span>
            <Button variant="destructive" disabled={Boolean(busy)} on_click={() => void remove_file(draft)}>确认删除</Button>
            <Button disabled={Boolean(busy)} on_click={() => set_delete_id(undefined)}>取消</Button>
          </span>} /> : null}
        </Group>)}
      </Section>
    </Page>;
  }

/** 新建草稿只提供可直接编辑的最小 TOML 模板。 */
const DEFAULT_SERVER_CONTENT = '# 将 command 替换为本机已安装的 MCP Server 可执行程序路径\nenabled = true\n\ncommand = "/absolute/path/to/mcp-server"\nargs = []\n';

/** 合并快照时只替换操作目标和未编辑文件，保留其他草稿及其原文基线。 */
function merge_snapshot(drafts: McpConfigFileDraft[], snapshot: McpConfigSnapshotView, replace_id?: string): McpConfigFileDraft[] {
  const preserved = drafts.filter((draft) => draft.id !== replace_id && (draft.create || draft.content !== draft.original_content));
  return [
    ...snapshot.servers.map((file) => preserved.find((draft) => draft.id === file.id) ?? { ...file, draft_key: `file:${file.id}`, original_content: file.content, create: false }),
    ...preserved.filter((draft) => !snapshot.servers.some((file) => file.id === draft.id)),
  ];
}

/** 将通道错误转为可见消息，不对配置原文进行解析或转换。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
