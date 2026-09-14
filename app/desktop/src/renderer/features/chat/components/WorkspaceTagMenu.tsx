/** Chat 主视图 Header 中可操作的 Workspace 标签。 */

import { useState } from "react";
import { TbBrandVscode, TbChevronDown, TbCopy, TbExternalLink, TbFolder } from "react-icons/tb";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { use_translation } from "@/locales/i18n";
import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** 提供当前 Workspace 的高频本地目录操作，不改变 Session 的执行边界。 */
export function WorkspaceTagMenu({ workspace }: { /** 当前 Session 绑定的 Workspace。 */ workspace: DesktopWorkspaceSummary }) {
  const translate = use_translation("resources");
  const [copied, set_copied] = useState(false);

  const copy_path = async () => {
    await navigator.clipboard.writeText(workspace.workspace_path);
    set_copied(true);
    window.setTimeout(() => set_copied(false), 1200);
  };

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className="inline-flex h-5 min-w-0 max-w-40 shrink-0 items-center gap-1 rounded-full bg-surface-subtle px-2 text-[0.625rem] font-normal text-muted-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 data-[popup-open]:bg-surface-emphasis data-[popup-open]:text-foreground"
        title={workspace.workspace_path}
        aria-label={translate("workspace.item_actions", { name: workspace.name })}
      >
        <TbFolder className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{workspace.name}</span>
        <TbChevronDown className="size-2.5 shrink-0" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" sideOffset={5} className="min-w-48">
      <DropdownMenuItem onClick={() => void window.downcity.system.open_in_vscode(workspace.workspace_path)}>
        <TbBrandVscode /><span>{translate("workspace.open_vscode")}</span>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => void window.downcity.system.open_local_file(workspace.workspace_path)}>
        <TbExternalLink /><span>{translate("workspace.open_finder")}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => void copy_path()}>
        <TbCopy /><span>{translate(copied ? "workspace.copied" : "workspace.copy_path")}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
