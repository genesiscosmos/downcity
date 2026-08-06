/** Fedman 用户 Usage 明细、排序、分页与详情 Sheet。 */

import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@downcity/ui";
import { ArrowLeftIcon, ArrowRightIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { MessageState, MetricCards, RemoteDataNotice } from "../components/Common.js";
import { use_remote_data } from "../hooks/use_remote_data.js";
import { analytics_url, request_json } from "../lib/api.js";
import { format_compact_number, format_duration, format_number, format_percent } from "../lib/format.js";
import type { UsageUser, UsageUsersResponse } from "../types/api.js";
import type { UsageDrawerProps, UsageSortKey, UsageTableProps, UsageUsersPageProps } from "../types/ui.js";

const page_size = 25;
const sort_items: Array<{ label: string; value: UsageSortKey }> = [
  { label: "按 Token 消耗", value: "total_tokens" },
  { label: "按 Credits 消耗", value: "credits_used" },
  { label: "按调用量", value: "execution_count" },
  { label: "按 P95 耗时", value: "p95_duration_ms" },
  { label: "按最后活跃", value: "last_active_at" },
];

/** 渲染用户 Usage 明细页。 */
export function UsageUsersPage({ range, refresh_key }: UsageUsersPageProps) {
  const state = use_remote_data(async () => await request_json<UsageUsersResponse>(analytics_url("users", range)), [range, refresh_key]);
  const [query, set_query] = useState("");
  const [sort_key, set_sort_key] = useState<UsageSortKey>("total_tokens");
  const [page, set_page] = useState(1);
  const [selected_user, set_selected_user] = useState<UsageUser | null>(null);

  const filtered_users = useMemo(() => sort_usage_users(
    (state.data?.items ?? []).filter((item) => `${item.user_id} ${item.email}`.toLowerCase().includes(query.toLowerCase())),
    sort_key,
  ), [state.data, query, sort_key]);
  const page_count = Math.max(1, Math.ceil(filtered_users.length / page_size));
  const current_page = Math.min(page, page_count);
  const page_users = filtered_users.slice((current_page - 1) * page_size, current_page * page_size);

  if (state.loading) return <MessageState tone="loading">正在读取用户用量…</MessageState>;
  if (state.error && !state.data) return <MessageState tone="error">{state.error.message}</MessageState>;
  return <>
    <RemoteDataNotice refreshing={state.refreshing} error={state.error} />
    <div className="toolbar">
      <InputGroup className="search-field"><InputGroupAddon><SearchIcon /></InputGroupAddon><InputGroupInput value={query} onChange={(event) => { set_query(event.target.value); set_page(1); }} placeholder="搜索邮箱或 user_id" /></InputGroup>
      <Select items={sort_items} value={sort_key} onValueChange={(value) => { set_sort_key(value as UsageSortKey); set_page(1); }}>
        <SelectTrigger aria-label="用户排序方式"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>{sort_items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      <Badge variant="outline">{state.data?.items.length ?? 0} USERS</Badge>
    </div>
    <UsageTable users={page_users} on_select={set_selected_user} />
    <div className="pagination"><span>{format_number(filtered_users.length)} 位用户 · 第 {current_page} / {page_count} 页</span><div>
      <Button disabled={current_page <= 1} variant="outline" onClick={() => set_page(current_page - 1)}><ArrowLeftIcon data-icon="inline-start" />上一页</Button>
      <Button disabled={current_page >= page_count} variant="outline" onClick={() => set_page(current_page + 1)}>下一页<ArrowRightIcon data-icon="inline-end" /></Button>
    </div></div>
    {selected_user ? <UsageDrawer user={selected_user} on_close={() => set_selected_user(null)} /> : null}
  </>;
}

/** 渲染当前页用户表。 */
function UsageTable({ users, on_select }: UsageTableProps) {
  if (!users.length) return <MessageState>没有匹配的用户</MessageState>;
  return <Table><TableHeader><TableRow><TableHead>用户</TableHead><TableHead>最后活跃</TableHead><TableHead>调用</TableHead><TableHead>Total Tokens</TableHead><TableHead>Credits</TableHead><TableHead>成功率</TableHead><TableHead>平均 / P95</TableHead><TableHead>Top Model</TableHead><TableHead /></TableRow></TableHeader><TableBody>{users.map((item) => <TableRow key={item.user_id}>
    <TableCell><div className="user-cell"><Avatar><AvatarFallback>{(item.email || item.user_id || "U").slice(0, 1).toUpperCase()}</AvatarFallback></Avatar><div><strong>{item.email || "—"}</strong><small>{item.user_id}</small></div></div></TableCell>
    <TableCell>{item.last_active_at ? new Date(item.last_active_at).toLocaleString() : "从未活跃"}</TableCell><TableCell>{format_number(item.execution_count)}</TableCell><TableCell>{format_compact_number(item.total_tokens)}</TableCell><TableCell>{format_compact_number(item.credits_used)}</TableCell><TableCell>{format_percent(item.success_rate)}</TableCell><TableCell>{format_duration(item.average_duration_ms)} / {format_duration(item.p95_duration_ms)}</TableCell><TableCell><Badge variant="secondary">{item.top_model_id || "—"}</Badge></TableCell><TableCell><Button variant="ghost" onClick={() => on_select(item)}>详情<ArrowRightIcon data-icon="inline-end" /></Button></TableCell>
  </TableRow>)}</TableBody></Table>;
}

/** 渲染单用户 Usage 详情 Sheet。 */
function UsageDrawer({ user, on_close }: UsageDrawerProps) {
  return <Sheet open onOpenChange={(open) => { if (!open) on_close(); }}><SheetContent className="user-sheet">
    <SheetHeader><SheetTitle>{user.email || user.user_id}</SheetTitle><SheetDescription>{user.user_id} · USER ANALYTICS</SheetDescription></SheetHeader>
    <div className="sheet-body"><MetricCards items={[
      { label: "调用", value: format_number(user.execution_count), hint: `${format_number(user.succeeded_count)} 成功` },
      { label: "Tokens", value: format_compact_number(user.total_tokens), hint: `Cached ${format_compact_number(user.cached_input_tokens)}` },
      { label: "Credits", value: format_compact_number(user.credits_used), hint: `${format_number(user.charge_count)} charges` },
      { label: "P95", value: format_duration(user.p95_duration_ms), hint: `平均 ${format_duration(user.average_duration_ms)}` },
    ]} />
    <div className="detail-list"><div><span>执行结果</span><strong>{format_number(user.succeeded_count)} / {format_number(user.failed_count)} / {format_number(user.cancelled_count)}</strong></div><div><span>Input / Output</span><strong>{format_compact_number(user.input_tokens)} / {format_compact_number(user.output_tokens)}</strong></div><div><span>Reasoning Tokens</span><strong>{format_compact_number(user.reasoning_tokens)}</strong></div><div><span>图片 / 视频 / 音频</span><strong>{format_number(user.image_count)} / {format_number(user.video_seconds)}s / {format_number(user.audio_seconds)}s</strong></div><div><span>计量不可用</span><strong>{format_number(user.metering_unavailable_count)}</strong></div></div></div>
  </SheetContent></Sheet>;
}

/** 按选定字段和 user_id 稳定排序。 */
function sort_usage_users(items: UsageUser[], sort_key: UsageSortKey): UsageUser[] {
  return [...items].sort((left, right) => {
    const difference = sort_key === "last_active_at"
      ? right.last_active_at.localeCompare(left.last_active_at)
      : Number(right[sort_key] || 0) - Number(left[sort_key] || 0);
    return difference || left.user_id.localeCompare(right.user_id);
  });
}
