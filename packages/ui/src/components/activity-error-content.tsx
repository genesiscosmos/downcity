/**
 * Activity 的唯一错误正文：原因占满内容宽度，复制操作在正文下方右对齐。
 * 继承共享面板文字排版，不添加警告卡片或重复标题；原文仅在显式复制时交给剪贴板。
 */
import { useState } from "react";
import { TbCheck, TbCopy } from "react-icons/tb";
import type { ActivityErrorContentProps } from "../types/activity-error-content";
import { bounded_text, redact_private } from "../lib/activity/activity_detail_shared";
import { default_control_translate, use_control_translation } from "../lib/control-messages";

/** 独用时可传宿主翻译，组合时继承 Activity 文案；缺失 key 回退到 SDK 默认文案。 */
export function ActivityErrorContent({ reason, original, translate }: ActivityErrorContentProps) {
  const inherited_translate = use_control_translation();
  const [copy_state, set_copy_state] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const text = (key: string) => {
    const value = (translate ?? inherited_translate)(key);
    return value === key ? default_control_translate(key) : value;
  };
  const copy_label = text("chat:activity.error_detail.copy");
  const status = copy_state === "copied" ? text("chat:activity.error_detail.copied")
    : copy_state === "failed" ? text("chat:activity.error_detail.copy_failed") : "";
  const can_copy = Boolean(original?.trim());
  const copy = async () => {
    if (!original?.trim() || copy_state === "copying") return;
    set_copy_state("copying");
    try {
      await navigator.clipboard.writeText(redact_private(original));
      set_copy_state("copied");
    } catch { set_copy_state("failed"); }
  };
  return <div className="activity-error-content">
    <p role="alert" className="activity-error-reason">{redact_private(bounded_text(reason))}</p>
    {can_copy ? <div className="activity-error-actions">
      <span role="status" aria-live="polite" className="activity-error-status">{status}</span>
      <button type="button" className="activity-error-copy" title={copy_label} aria-label={copy_label}
        disabled={copy_state === "copying"} onClick={() => { void copy(); }}>
        {copy_state === "copied" ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}
      </button>
    </div> : null}
  </div>;
}
