/** Fedman 基于 Downcity UI 的管理资源页与 Env/Bureau 操作。 */

import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Badge,
  Button,
  FormField,
  Input,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@downcity/ui";
import { ArrowLeftIcon, CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageState } from "../components/Common.js";
import { request_json } from "../lib/api.js";
import { error_message, format_value } from "../lib/format.js";
import type { ActionResponse, ResourceListResponse } from "../types/api.js";
import type { ResourceAction, ResourceNotice, ResourcePageProps, ResourceTableProps } from "../types/ui.js";

/** 渲染通用管理资源及其有限操作。 */
export function ResourcePage({ resource_id, refresh_key }: ResourcePageProps) {
  const resource_id_ref = useRef(resource_id);
  const [view_id, set_view_id] = useState(resource_id);
  const [items, set_items] = useState<Array<Record<string, unknown>>>([]);
  const [loading, set_loading] = useState(true);
  const [refreshing, set_refreshing] = useState(false);
  const [load_error, set_load_error] = useState("");
  const [action_loading, set_action_loading] = useState(false);
  const [notice, set_notice] = useState<ResourceNotice | null>(null);
  const [confirm_action, set_confirm_action] = useState<ResourceAction | null>(null);
  const [env_key, set_env_key] = useState("");
  const [env_value, set_env_value] = useState("");
  const [bureau_id, set_bureau_id] = useState("");
  const [bureau_name, set_bureau_name] = useState("");
  const [bureau_url, set_bureau_url] = useState("");

  const load_resource = async (next_view_id: string, preserve_data: boolean) => {
    set_loading(!preserve_data);
    set_refreshing(preserve_data);
    set_load_error("");
    try {
      const response = await request_json<ResourceListResponse>(`/api/resources/${encodeURIComponent(next_view_id)}`);
      set_items(response.items);
    } catch (load_failure) {
      set_load_error(error_message(load_failure));
    } finally {
      set_loading(false);
      set_refreshing(false);
    }
  };

  useEffect(() => {
    const changed_resource = resource_id_ref.current !== resource_id;
    resource_id_ref.current = resource_id;
    set_view_id(resource_id);
    if (changed_resource) set_items([]);
    void load_resource(resource_id, !changed_resource && items.length > 0);
    // 资源刷新由 refresh_key 显式驱动；items 只用于判断是否保留已展示的数据。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource_id, refresh_key]);

  const execute_action = async (action: ResourceAction) => {
    const payload = action.startsWith("env_")
      ? { key: env_key, value: env_value }
      : { bureau_id, name: bureau_name, server_url: bureau_url };
    set_action_loading(true);
    set_notice(null);
    try {
      await request_json<ActionResponse>("/api/actions", { method: "POST", body: JSON.stringify({ action, payload }) });
      set_notice({ tone: "success", message: "操作成功，资源数据已刷新。" });
      await load_resource(resource_id, true);
    } catch (action_error) {
      set_notice({ tone: "error", message: error_message(action_error) });
    } finally {
      set_action_loading(false);
      set_confirm_action(null);
    }
  };

  const run_action = (action: ResourceAction) => {
    if (action === "bureau_archive" || action === "env_remove") {
      set_confirm_action(action);
      return;
    }
    void execute_action(action);
  };

  const open_secondary = async (secondary_id: string) => {
    set_view_id(secondary_id as typeof resource_id);
    set_items([]);
    await load_resource(secondary_id, false);
  };

  if (loading) return <MessageState tone="loading">正在读取管理资源…</MessageState>;
  if (load_error && !items.length) return <MessageState tone="error">{load_error}</MessageState>;
  return <>
    <div className="toolbar">
      {view_id !== resource_id ? <Button variant="outline" onClick={() => { set_view_id(resource_id); set_items([]); void load_resource(resource_id, false); }}><ArrowLeftIcon data-icon="inline-start" />返回</Button> : null}
      <Badge variant="outline">{items.length} RECORDS</Badge>
      {refreshing ? <Badge variant="secondary"><Spinner size="sm" />刷新中</Badge> : null}
      {view_id === resource_id && resource_id === "credits_users" ? <Button variant="outline" onClick={() => void open_secondary("credits_transactions")}>查看 Transactions</Button> : null}
      {view_id === resource_id && resource_id === "payments" ? <Button variant="outline" onClick={() => void open_secondary("payment_events")}>查看 Webhook Events</Button> : null}
    </div>
    {view_id === resource_id && resource_id === "env" ? <div className="resource-form"><FormField label="环境变量名称"><Input value={env_key} onChange={(event) => set_env_key(event.target.value)} placeholder="ENV_KEY" /></FormField><FormField label="环境变量值"><Input value={env_value} onChange={(event) => set_env_value(event.target.value)} type="password" placeholder="value" /></FormField><div className="resource-actions"><Button disabled={action_loading} variant="primary" onClick={() => run_action("env_upsert")}>{action_loading ? <Spinner data-icon="inline-start" /> : null}保存</Button><Button disabled={action_loading} variant="destructive" onClick={() => run_action("env_remove")}>删除</Button><Button disabled={action_loading} variant="outline" onClick={() => run_action("env_refresh")}>刷新 Runtime</Button></div></div> : null}
    {view_id === resource_id && resource_id === "bureaus" ? <div className="resource-form"><FormField label="Bureau ID"><Input value={bureau_id} onChange={(event) => set_bureau_id(event.target.value)} placeholder="bureau_id" /></FormField><FormField label="名称"><Input value={bureau_name} onChange={(event) => set_bureau_name(event.target.value)} placeholder="name" /></FormField><FormField label="Server URL"><Input value={bureau_url} onChange={(event) => set_bureau_url(event.target.value)} placeholder="server_url" /></FormField><div className="resource-actions"><Button disabled={action_loading} variant="primary" onClick={() => run_action("bureau_create")}>创建</Button><Button disabled={action_loading} variant="outline" onClick={() => run_action("bureau_activate")}>启用</Button><Button disabled={action_loading} variant="outline" onClick={() => run_action("bureau_pause")}>暂停</Button><Button disabled={action_loading} variant="destructive" onClick={() => run_action("bureau_archive")}>归档</Button></div></div> : null}
    {load_error ? <Alert variant="destructive"><CircleAlertIcon /><div><AlertTitle>刷新失败，当前仍展示上次数据</AlertTitle><AlertDescription>{load_error}</AlertDescription></div></Alert> : null}
    {notice ? <Alert variant={notice.tone === "error" ? "destructive" : "default"}>{notice.tone === "error" ? <CircleAlertIcon /> : <CircleCheckIcon />}<div><AlertTitle>{notice.tone === "error" ? "操作失败" : "操作成功"}</AlertTitle><AlertDescription>{notice.message}</AlertDescription></div></Alert> : null}
    <ResourceTable items={items} />
    <AlertDialog open={confirm_action !== null} onOpenChange={(open) => { if (!open) set_confirm_action(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认危险操作</AlertDialogTitle><AlertDialogDescription>即将执行 {confirm_action}。该操作会修改 Federation 资源，请确认目标信息无误。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogClose render={<Button variant="outline" />}>取消</AlertDialogClose><Button disabled={action_loading} variant="destructive" onClick={() => { if (confirm_action) void execute_action(confirm_action); }}>{action_loading ? <Spinner data-icon="inline-start" /> : null}确认执行</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

/** 渲染最多十个稳定字段的资源表。 */
function ResourceTable({ items }: ResourceTableProps) {
  const keys = useMemo(() => [...new Set(items.flatMap((item) => Object.keys(item)))].slice(0, 10), [items]);
  if (!items.length) return <MessageState>暂无数据</MessageState>;
  return <Table><TableHeader><TableRow>{keys.map((key) => <TableHead key={key}>{key}</TableHead>)}</TableRow></TableHeader><TableBody>{items.map((item, index) => <TableRow key={String(item.id ?? item.user_id ?? item.bureau_id ?? index)}>{keys.map((key) => <TableCell title={format_value(item[key])} key={key}>{format_value(item[key])}</TableCell>)}</TableRow>)}</TableBody></Table>;
}
