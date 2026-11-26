"use client";
/** 活动 Shell 只读列表：复用状态面板布局，命令截断并保留原生全文悬停提示。 */
import { TbLoader2 } from "react-icons/tb";
import { ControlMessagesProvider, use_control_translation as use_translation } from "../../lib/control-messages";
import type { ShellListProps } from "../../types/status-panel";
import { StatusPanelHeader } from "./StatusPanelHeader";

/** 进程事实由宿主更新；列表不解析工具消息，也不执行命令。 */
function ShellListContent({ items }: ShellListProps) {
  const translate = use_translation("chat");
  return <div className="status-panel-list-area flex flex-col gap-0.5">
    <StatusPanelHeader title={translate("status_panel.shells")} />
    <div className="status-panel-list">
      {items.map(item => <div key={item.key} className="status-panel-item text-foreground">
        <TbLoader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div title={item.cmd} className="truncate font-mono">{item.cmd}</div>
          <div title={item.session_label} className="truncate text-2xs text-muted-foreground">{item.session_label}</div>
        </div>
        <span className="shrink-0 text-2xs text-muted-foreground">{translate(`status_panel.shell_${item.status}`)}</span>
      </div>)}
    </div>
  </div>;
}

/** 独用时接收宿主文案，组合时继承面板文案。 */
export function ShellList(props: ShellListProps) {
  return <ControlMessagesProvider translate={props.translate}><ShellListContent {...props} /></ControlMessagesProvider>;
}
