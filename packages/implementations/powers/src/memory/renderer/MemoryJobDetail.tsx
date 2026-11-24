/**
 * Memory Job 的有界差异与证据展示。
 * 只消费 job_detail 固定快照，不读取当前知识或 Profile；正文和来源均按纯文本渲染。
 * 每次展示一条变更，正文按字符分段、证据分页；当前段随所属页面滚动，不创建内部纵向滚动。
 */
import { useState } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { MemoryJobDetail, MemoryJobChangeDetail } from "../types/MemoryJob.js";

/** 差异组件只接收已授权的详情与宿主 UI。 */
interface MemoryJobChangesProps {
  /** 独立详情接口返回的固定差异与真实提交状态。 */
  detail: MemoryJobDetail;
  /** 宿主提供的界面组件，不接触 Memory Provider。 */
  ui: PowerMainviewComponentProps["ui"];
}

const TEXT_PAGE_SIZE = 1800;
const SOURCE_PAGE_SIZE = 3;
const OPERATION_LABELS: Record<MemoryJobChangeDetail["operation"], string> = {
  create: "新增知识", update: "更新知识", invalidate: "使知识失效", profile_edit: "编辑核心记忆",
};
const ROLE_LABELS = { user: "用户原文", agent: "Agent 原文", request: "显式请求原文" };

/** 逐条查看暂存或已提交的差异，成功状态之外均不宣称保存生效。 */
export function memory_job_changes({ detail, ui }: MemoryJobChangesProps) {
  const { Button, Callout, EmptyState, Group, Inline, Row, Status } = ui.components;
  const [change_index, set_change_index] = useState(0);
  const [source_offset, set_source_offset] = useState(0);
  const [before_offset, set_before_offset] = useState<number>();
  const [after_offset, set_after_offset] = useState<number>();
  const change = detail.changes[Math.min(change_index, detail.changes.length - 1)];
  const committed = detail.job.status === "succeeded";
  const explanation = committed
    ? "以下是本次已提交的固定差异，不代表此后仍是最新正文。"
    : detail.job.status === "failed"
      ? "处理失败，以下仅为当时暂存的计划。提交结果未确认，不能视为已生效。"
      : detail.job.status === "skipped"
        ? "本次无需变更，没有新的已生效内容。"
        : "以下仅为暂存计划，尚未确认提交，不能视为已生效。";
  if (!change) return <EmptyState title="没有可展示的固定差异" size="compact"
    description={committed ? "该记录未保存历史差异快照，无法还原提交前后内容。" : "尚无暂存差异；当前状态不表示已保存新的记忆。"} />;

  const before = change.before?.content ?? "";
  const after = change.after.content;
  const { prefix, suffix } = changed_span(before, after);
  const initial_offset = before === after ? 0 : Math.floor(Math.max(0, prefix - 200) / TEXT_PAGE_SIZE) * TEXT_PAGE_SIZE;
  const current_before_offset = Math.min(before_offset ?? initial_offset, Math.max(0, before.length - 1));
  const current_after_offset = Math.min(after_offset ?? initial_offset, Math.max(0, after.length - 1));
  const current_source_offset = Math.min(source_offset, Math.max(0, Math.floor((change.sources.length - 1) / SOURCE_PAGE_SIZE) * SOURCE_PAGE_SIZE));

  /** 切换变更时重置正文与证据分页，防止把上一项偏移用于另一份正文。 */
  const select_change = (index: number) => {
    set_change_index(index); set_source_offset(0); set_before_offset(undefined); set_after_offset(undefined);
  };

  return <Group>
    <Callout tone={committed ? "default" : detail.job.status === "failed" ? "danger" : "warning"}>{explanation}</Callout>
    <Inline>
      <Button disabled={change_index === 0} on_click={() => select_change(change_index - 1)}>上一条差异</Button>
      <Status>{Math.min(change_index + 1, detail.changes.length)} / {detail.changes.length}</Status>
      <Button disabled={change_index + 1 >= detail.changes.length} on_click={() => select_change(change_index + 1)}>下一条差异</Button>
    </Inline>
    <Row label={OPERATION_LABELS[change.operation]} description={change.topic}
      trailing={<Status tone={committed ? "success" : "muted"}>{committed ? "已提交差异" : "未确认生效"}</Status>} />
    {change.memory_id ? <Row label="知识 ID" description={change.memory_id} /> : null}
    {change.expected_version ? <Row label="实际读取版本" description={change.expected_version} /> : null}
    <Row label="快照读取时间" description={change.captured_at} />
    {change.operation === "profile_edit" ? <Callout tone="default">前后内容仅展示精确编辑区域，版本对应当时读取的完整 Profile。</Callout> : null}
    {change.operation === "invalidate" ? <Callout tone="default">此操作保留正文并将知识标记为失效，因此前后正文可能相同。</Callout> : null}
    {change.before === null ? <Row label="变更前" description="新增记录，没有旧正文。" />
      : render_snapshot(ui, "变更前", before, current_before_offset, set_before_offset, prefix, before.length - suffix)}
    {render_snapshot(ui, committed ? "提交后" : "计划变更后", after, current_after_offset, set_after_offset, prefix, after.length - suffix)}
    <Row label="具体来源" description="角色与定位来自本 Job 的授权输入包；摘录为其中连续匹配的原文。" />
    {change.sources.slice(current_source_offset, current_source_offset + SOURCE_PAGE_SIZE).map((source, index) => <Group key={`${source.source_id}:${source.excerpt_start}:${index}`}>
      <Row label={`${source.source_id} · ${ROLE_LABELS[source.role]}`}
        description={`${source.agent_id} · ${source.category}${source.session_id ? ` · Session ${source.session_id}` : ""}${source.message_id ? ` · 消息 ${source.message_id}` : ""}`} />
      <pre style={{ margin: 0, padding: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", overflowX: "auto", fontSize: 12 }}>
        {source.excerpt}
      </pre>
      <Row label="原文定位" description={`字符偏移 ${source.excerpt_start}–${source.excerpt_start + source.excerpt.length}${source.truncated ? " · 仅展示摘录" : " · 完整来源正文"}`} />
    </Group>)}
    {change.sources.length > SOURCE_PAGE_SIZE ? <Inline>
      <Button disabled={current_source_offset === 0} on_click={() => set_source_offset(current_source_offset - SOURCE_PAGE_SIZE)}>上一组来源</Button>
      <Status>{current_source_offset + 1}–{Math.min(current_source_offset + SOURCE_PAGE_SIZE, change.sources.length)} / {change.sources.length}</Status>
      <Button disabled={current_source_offset + SOURCE_PAGE_SIZE >= change.sources.length} on_click={() => set_source_offset(current_source_offset + SOURCE_PAGE_SIZE)}>下一组来源</Button>
    </Inline> : null}
  </Group>;
}

/** 以最长共同前缀与后缀定位修改区域，不执行高复杂度的全文字符差分。 */
function changed_span(before: string, after: string): { /** 两份正文相同的起始字符数。 */ prefix: number; /** 不与前缀重叠的相同结尾字符数。 */ suffix: number } {
  let prefix = 0;
  const common_length = Math.min(before.length, after.length);
  while (prefix < common_length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < common_length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix += 1;
  return { prefix, suffix };
}

/** 纯文本分段展示固定正文，突出本段与另一份快照不同的部分。 */
function render_snapshot(
  ui: PowerMainviewComponentProps["ui"], label: string, content: string,
  offset: number, set_offset: (offset: number) => void, changed_start: number, changed_end: number,
) {
  const { Button, Group, Inline, Row, Status } = ui.components;
  const end = Math.min(content.length, offset + TEXT_PAGE_SIZE);
  const highlight_start = Math.min(end, Math.max(offset, changed_start));
  const highlight_end = Math.max(highlight_start, Math.min(end, changed_end));
  return <Group>
    <Row label={label} description={content.length ? `原文字符 ${offset + 1}–${end} / ${content.length}；高亮区域为差异。` : "空正文（删除此编辑区域）"} />
    <pre style={{ margin: 0, padding: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", overflowX: "auto", fontSize: 12 }}>
      {content.slice(offset, highlight_start)}
      {highlight_end > highlight_start ? <mark style={{ background: "rgba(234, 179, 8, 0.2)", color: "inherit" }}>{content.slice(highlight_start, highlight_end)}</mark> : null}
      {content.slice(highlight_end, end)}
    </pre>
    {content.length > TEXT_PAGE_SIZE ? <Inline>
      <Button disabled={offset === 0} on_click={() => set_offset(Math.max(0, offset - TEXT_PAGE_SIZE))}>上一段</Button>
      <Status>每段最多 {TEXT_PAGE_SIZE} 字符</Status>
      <Button disabled={end >= content.length} on_click={() => set_offset(end)}>下一段</Button>
    </Inline> : null}
  </Group>;
}
