/** Desktop 按业务职责组织的页面与应用组件。 */

import { createPortal } from "react-dom";

import { AttachSessionWorkspaceDialog } from "@/components/AttachSessionWorkspaceDialog";
import { Button } from "@/components/ui/button";
import { use_desktop_selector } from "@/app/use_desktop";
import { use_translation } from "@/locales/i18n";

import type { DesktopController } from "@/types/DesktopView";

/** 全局错误只订阅错误文本，避免设置其它字段变化刷新应用壳。 */
export function DesktopErrorHost({ controller }: { /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const translate = use_translation();
  const error = use_desktop_selector(controller.stores.settings, (state) => state.error);
  return error ? createPortal(<div className="fixed bottom-5 left-1/2 z-[60] flex max-w-xl -translate-x-1/2 items-start gap-3 rounded-surface border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"><span className="min-w-0 flex-1 break-words">{error}</span><Button onClick={controller.actions.clear_error}>{translate("actions.close")}</Button></div>, document.body) : null;
}

/** 孤儿 Session 绑定弹窗独立订阅请求与 Workspace 列表。 */
export function SessionAttachHost({ controller }: { /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const request = use_desktop_selector(controller.stores.session, (state) => state.session_attach_request);
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  return <AttachSessionWorkspaceDialog request={request} workspaces={workspaces} close_dialog={controller.actions.clear_session_attach_request} rebind_session_workspace={controller.actions.rebind_session_workspace} create_workspace_for_session={controller.actions.create_workspace_for_session} />;
}
