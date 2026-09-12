/**
 * Group 配置草稿的本地状态与自动保存。
 *
 * 状态提升到页面级的原因：右侧 BayBar 的每个配置分区是一个 tab，编辑器被拆成多个视图。
 * 状态留在编辑器内部会导致切 tab 重新初始化草稿、丢失正在编辑的内容。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopGroupSummary } from "@common/types/DesktopApi";
import type { DesktopController } from "@/types/DesktopView";

/** 自动保存防抖时长。 */
const AUTOSAVE_DELAY_MS = 500;

/** Group 草稿编辑状态。 */
export interface GroupDraftState {
  /** 当前可编辑草稿。 */
  draft: DesktopGroupSummary;
  /** 用新草稿替换当前值，并触发防抖保存。 */
  update_draft(next: DesktopGroupSummary): void;
}

/** 维护一个 Group 的可编辑草稿。 */
export function use_group_draft(group: DesktopGroupSummary, controller: DesktopController): GroupDraftState {
  const [draft, set_draft] = useState(group);
  const [dirty, set_dirty] = useState(false);
  const version_ref = useRef(0);

  // 外部数据变化时同步草稿；正在编辑时不覆盖用户的输入。
  useEffect(() => {
    if (!dirty) set_draft(group);
    version_ref.current += 1;
  }, [dirty, group]);

  const update_draft = useCallback((next: DesktopGroupSummary) => {
    version_ref.current += 1;
    set_draft(next);
    set_dirty(true);
  }, []);

  useEffect(() => {
    if (!dirty || draft.group_id !== group.group_id) return;
    const version = version_ref.current;
    const timeout_id = window.setTimeout(() => {
      void controller.actions.update_group(group.group_id, {
        name: draft.name,
        model_id: draft.model_id,
        instruction: draft.instruction || "",
        member_agent_ids: draft.members.map((member) => member.agent_id),
      }).then(() => { if (version_ref.current === version) set_dirty(false); }).catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);
    return () => { window.clearTimeout(timeout_id); };
  }, [controller.actions, draft, dirty, group.group_id]);

  return useMemo(() => ({ draft, update_draft }), [draft, update_draft]);
}
