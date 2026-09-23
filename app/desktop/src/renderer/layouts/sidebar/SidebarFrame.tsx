/** Desktop 左侧 Sidebar 的唯一布局外壳。 */

import type { ReactNode } from "react";
import { ShellPanel } from "@/layouts/ShellPanel";
import { SHELL_BAYBAR_MIN_WIDTH, SHELL_HEADER_HEIGHT_CSS, SHELL_SIDEBAR_DEFAULT_WIDTH, SHELL_SIDEBAR_MIN_WIDTH } from "@/layouts/shellMotion";
import { use_translation } from "@/locales/i18n";

/** Sidebar 外壳属性。 */
interface SidebarFrameProps {
  /** Sidebar 是否折叠。 */
  collapsed: boolean;
  /** Rail 与当前 Panel。 */
  children: ReactNode;
}

/**
 * 持有 Sidebar 的宽度、折叠动画、窗口拖拽区和调整尺寸能力。
 * 业务 Panel 不应重复实现这些 Shell 级布局规则。
 *
 * 列结构与把手接线都在 `ShellPanel` 里（与右侧面板共用），这里只声明侧栏自己的三件事：
 * 宽度范围与持久化键、拖拽带高度、以及 children 的横向排布（Rail 与 Panel 并排）。
 *
 * 宽度没有上限常量：上限由窗口实时算出来，而算它时需要为右栏预留位置，
 * 因此把右栏的最小宽度一并交进去（见 ShellPanel）。
 */
export function SidebarFrame({ collapsed, children }: SidebarFrameProps) {
  const translate = use_translation("navigation");
  return <ShellPanel
    side="left"
    collapsed={collapsed}
    label={translate("views.workspaces")}
    resize={{
      min_width: SHELL_SIDEBAR_MIN_WIDTH,
      default_width: SHELL_SIDEBAR_DEFAULT_WIDTH,
      storage_key: "downcity.sidebar_width",
      // 侧栏拖宽时不能把右栏挤没：为它预留它的最小宽度。
      other_min_width: SHELL_BAYBAR_MIN_WIDTH,
    }}
    resize_label={translate("sidebar.resize")}
  >
    {/* `select-none` 与 `whitespace-nowrap` 只属于侧栏：这里的文字是导航标签，
        既不参与选择、也不该折行。右栏要能选中文件预览与编辑器文本，因此不放进 ShellPanel。 */}
    <div className="flex h-full min-h-0 select-none flex-col overflow-hidden whitespace-nowrap">
      {/* 顶栏高度与 MainView 顶栏共用同一来源；写 h-10 只在 100% 缩放下恰好相等。 */}
      <div className="header-drag-region shrink-0" style={{ height: SHELL_HEADER_HEIGHT_CSS }} aria-hidden="true" />
      <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  </ShellPanel>;
}
