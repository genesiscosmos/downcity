/**
 * 文件预览顶栏的文件操作菜单。
 *
 * ## 为什么源码模式是菜单项而不是常驻切换控件
 *
 * 此前顶栏常驻一个「预览 / 源码」分段控件，两个问题：
 *
 * 1. **占用永久位置换一次性动作。** 绝大多数阅读发生在预览里，切源码是少数动作，
 *    分段控件让两种模式看起来同等重要。
 * 2. **它是 Markdown 专属，却常驻顶栏。** 非 Markdown 文件没有这个控件，
 *    顶栏在两类文件之间忽多忽少一件东西。
 *
 * 现在两类文件共用同一个菜单，顶栏形状恒定；Markdown 文档在菜单里多一项「源码模式」开关。
 *
 * ## 开关项留在菜单里，命令项关掉菜单
 *
 * 「源码模式」是就地改一个设置，用户要看着结果确认，所以菜单不关（Base UI 开关项的默认行为，
 * 与 macOS 菜单一致）；其余三项是一次性动作，执行后关闭菜单。
 *
 * ## 反馈为什么落在触发按钮上
 *
 * 命令项执行后菜单已经关闭，把「已复制」写在菜单项里没人看得见。触发按钮停在原地，
 * 图标换成对勾、无障碍名称同步改成「已复制」，与消息里 diff 卡片复制链接的做法一致。
 * 两个复制动作共用同一个反馈：用户刚点过哪一项自己清楚，界面不需要再复述一遍动作名。
 *
 * 复制失败与系统打开失败则显示在按钮**旁边**（`role="status"`）而不是按钮里：
 * 失败原因是一句话，塞不进 24px 的图标按钮；`role="status"` 让读屏也能听到。
 */

import { useEffect, useRef, useState } from "react";
import { TbCheck, TbCopy, TbDots, TbExternalLink, TbLink } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { build_workspace_file_link, resolve_workspace_absolute_path } from "@/lib/workspace/workspace_file_link";
import { use_translation } from "@/locales/i18n";
import type { WorkspaceFileViewMode } from "@/lib/workspace/workspace_file_preview";

/** 复制成功反馈的持续时间；与消息操作栏的复制反馈同值。 */
const COPIED_FEEDBACK_MS = 1200;

/** 失败反馈的持续时间；比成功长，因为用户需要时间读完那句话。 */
const ERROR_FEEDBACK_MS = 4000;

/** 文件操作菜单属性。 */
interface WorkspaceFileActionsMenuProps {
  /** Workspace 内相对路径。 */
  relative_path: string;
  /** Workspace 绝对路径；未登记时为空，此时无法用系统应用打开。 */
  workspace_path?: string;
  /** 打开文件时携带的 1 基行号；用于构造指向该行的链接。 */
  line?: number;
  /** 是否为 Markdown 文档；非文档没有源码模式开关。 */
  markdown_document: boolean;
  /** 当前阅读模式。 */
  view_mode: WorkspaceFileViewMode;
  /** 切换阅读模式。 */
  on_view_mode_change(mode: WorkspaceFileViewMode): void;
  /** 文件原始文本；「复制全文」复制它，而不是渲染结果。 */
  content: string;
}

/** 文件操作菜单：源码模式开关 + 复制全文 / 复制链接 / 用系统默认应用打开。 */
export function WorkspaceFileActionsMenu({ relative_path, workspace_path, line, markdown_document, view_mode, on_view_mode_change, content }: WorkspaceFileActionsMenuProps) {
  const translate_resources = use_translation("resources");
  const [copied, set_copied] = useState(false);
  const [error, set_error] = useState("");
  const copied_timer = useRef<number | undefined>(undefined);
  const error_timer = useRef<number | undefined>(undefined);

  // 两个定时器都必须在卸载时清掉：预览是随标签页挂载/卸载的，留着会在已卸载组件上 setState。
  useEffect(() => () => {
    window.clearTimeout(copied_timer.current);
    window.clearTimeout(error_timer.current);
  }, []);

  /** 复制动作的统一反馈：短暂把触发按钮切成对勾。 */
  const report_copied = () => {
    window.clearTimeout(copied_timer.current);
    set_copied(true);
    copied_timer.current = window.setTimeout(() => set_copied(false), COPIED_FEEDBACK_MS);
  };
  /** 失败反馈；这类失败用户无法自行恢复，因此保留得久一些。 */
  const report_error = (reason: unknown) => {
    window.clearTimeout(error_timer.current);
    set_error(reason instanceof Error ? reason.message : String(reason));
    error_timer.current = window.setTimeout(() => set_error(""), ERROR_FEEDBACK_MS);
  };

  const copy_content = async () => {
    try {
      await navigator.clipboard.writeText(content);
      report_copied();
    } catch (reason) {
      report_error(reason);
    }
  };
  const copy_link = async () => {
    try {
      await navigator.clipboard.writeText(build_workspace_file_link(workspace_path, relative_path, line));
      report_copied();
    } catch (reason) {
      report_error(reason);
    }
  };
  const open_with_system = async () => {
    const absolute_path = resolve_workspace_absolute_path(workspace_path, relative_path);
    if (!absolute_path) return;
    try {
      await window.downcity.system.open_local_file(absolute_path);
    } catch (reason) {
      report_error(reason);
    }
  };

  const menu_label = translate_resources("workspace.file_actions", { name: relative_path });
  return <>
    {error ? <span role="status" className="min-w-0 max-w-40 truncate text-2xs text-destructive" title={error}>{error}</span> : null}
    <DropdownMenu onOpenChange={(open) => { if (open) set_error(""); }}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          className="focus-visible:ring-2 focus-visible:ring-ring/30"
          title={menu_label}
          aria-label={copied ? translate_resources("workspace.copied") : menu_label}
        >{copied ? <TbCheck aria-hidden /> : <TbDots aria-hidden />}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={5}>
        {markdown_document ? <>
          <DropdownMenuCheckboxItem checked={view_mode === "source"} onCheckedChange={(checked) => on_view_mode_change(checked ? "source" : "preview")}>
            <span>{translate_resources("workspace.source_mode")}</span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
        </> : null}
        <DropdownMenuItem onClick={() => void copy_content()}><TbCopy className="size-3.5" aria-hidden /><span>{translate_resources("workspace.copy_content")}</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => void copy_link()}><TbLink className="size-3.5" aria-hidden /><span>{translate_resources("workspace.copy_link")}</span></DropdownMenuItem>
        {/*
          没有绝对路径时整项不渲染，而不是置灰：置灰的菜单项需要一句解释，而禁用项的
          `pointer-events-none` 让 title 提示根本弹不出来——用户只会看到一个不能点、
          也不知道为什么不能点的动作。这种情形只在 Workspace 已从 Registry 移除时出现。
        */}
        {workspace_path ? <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void open_with_system()}><TbExternalLink className="size-3.5" aria-hidden /><span>{translate_resources("workspace.open_with_default")}</span></DropdownMenuItem>
        </> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  </>;
}
