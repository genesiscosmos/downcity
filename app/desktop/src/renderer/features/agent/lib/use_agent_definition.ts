/**
 * Agent 定义的读取与自动保存。
 *
 * 状态提升到页面级的原因：右侧 BayBar 的每个分区是一个 tab，编辑器会被拆成多个视图。
 * 如果定义状态留在编辑器组件内部，每个 tab 都会各自拉取一次，且切 tab 时丢失未保存的编辑。
 * 放在这里之后，编辑器退化为纯视图，切换 tab 不会重复请求，也不会丢草稿。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopAgentDefinition } from "@common/types/DesktopApi";
import type { DesktopController } from "@/types/DesktopView";

/** 自动保存防抖时长。 */
const AUTOSAVE_DELAY_MS = 500;

/** Agent 定义编辑状态。 */
export interface AgentDefinitionState {
  /** 当前未保存的定义；尚未加载完成时为空。 */
  definition?: DesktopAgentDefinition;
  /** 是否正在读取定义。 */
  loading: boolean;
  /** 当前编辑或保存错误。 */
  error: string;
  /** 替换未保存的定义，并触发防抖保存。 */
  set_definition(value: DesktopAgentDefinition): void;
}

/** 读取并维护一个 Agent 的可编辑定义。 */
export function use_agent_definition(agent_id: string, controller: DesktopController): AgentDefinitionState {
  const [definition, set_definition_value] = useState<DesktopAgentDefinition>();
  const [loading, set_loading] = useState(true);
  const [dirty, set_dirty] = useState(false);
  const [error, set_error] = useState("");
  const version_ref = useRef(0);

  // 切换 Agent 时重新读取，避免沿用上一个 Agent 的定义。
  useEffect(() => {
    let disposed = false;
    set_definition_value(undefined);
    set_dirty(false);
    set_error("");
    set_loading(true);
    void controller.actions.get_agent(agent_id).then((next) => {
      if (!disposed) set_definition_value(next);
    }).catch((reason) => {
      if (!disposed) set_error(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!disposed) set_loading(false);
    });
    return () => { disposed = true; };
  }, [agent_id, controller.actions]);

  const set_definition = useCallback((value: DesktopAgentDefinition) => {
    version_ref.current += 1;
    set_definition_value(value);
    set_dirty(true);
  }, []);

  // 防抖保存；只提交定义中可编辑的字段。
  useEffect(() => {
    if (!dirty || !definition) return;
    const version = version_ref.current;
    const timeout_id = window.setTimeout(() => {
      void controller.actions
        .update_agent(agent_id, {
          name: definition.name,
          description: definition.description,
          model_id: definition.model_id,
          instruction: definition.instruction,
        })
        .then(() => { if (version_ref.current === version) set_dirty(false); })
        .catch((reason) => set_error(reason instanceof Error ? reason.message : String(reason)));
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timeout_id);
  }, [agent_id, controller.actions, definition, dirty]);

  return useMemo(() => ({ definition, loading, error, set_definition }), [definition, error, loading, set_definition]);
}
