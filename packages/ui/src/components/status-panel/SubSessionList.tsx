"use client";
/** StatusPanel 子会话列表：按层级展示标题，状态合并到左侧图标，通过宿主回调打开完整地址。 */
import { useState } from "react";
import { SubSessionStatusIcon } from "./SubSessionStatusIcon";
import { ControlMessagesProvider, use_control_translation as use_translation } from "../../lib/control-messages";
import type { SubSessionListProps } from "../../types/status-panel";
import { StatusPanelHeader } from "./StatusPanelHeader";

/** 列表在分类切换时保留挂载，错误仅属于本次导航，不影响会话内容。 */
function SubSessionListContent<Address>({ items, on_select }: SubSessionListProps<Address>) {
  const translate = use_translation("chat");
  const [error, set_error] = useState("");
  return <div className="status-panel-list-area flex flex-col gap-0.5">
    <StatusPanelHeader title={translate("status_panel.sessions")} />
    <div className="status-panel-list">
      {items.map((item) => {
        const title = item.title || translate("conversation.new");
        return <button key={item.key} type="button" title={title}
          className="status-panel-item text-foreground"
          onClick={() => {
            set_error("");
            void on_select(item.address).catch((reason) => set_error(reason instanceof Error ? reason.message : String(reason)));
          }}>
          <span className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: (item.depth - 1) * 12 }}>
            <span className="flex size-4 shrink-0 items-center justify-center">
              <SubSessionStatusIcon status={item.status} />
            </span>
            <span className="min-w-0 flex-1 truncate">{title}</span>
          </span>
        </button>;
      })}
    </div>
    {error ? <p role="alert" className="px-2 py-1 text-2xs text-destructive">{error}</p> : null}
  </div>;
}

/** 独用时接收宿主文案；组合时继承上层文案。 */
export function SubSessionList<Address>(props: SubSessionListProps<Address>) {
  return <ControlMessagesProvider translate={props.translate}><SubSessionListContent {...props} /></ControlMessagesProvider>;
}
