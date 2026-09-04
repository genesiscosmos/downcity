/** Task Plugin Renderer 的组件边界类型。 */

import type { PluginRendererUiComponents } from "@downcity/city/plugin/react";
import type {
  TaskMainviewEditorDraft,
  TaskMainviewItem,
  TaskMainviewWorkspace,
} from "./TaskMainview.js";

/** Task 编辑器组件属性。 */
export interface TaskEditorProps {
  /** 当前是创建还是编辑模式。 */
  readonly mode: "create" | "edit";
  /** 编辑模式下的既有 Task；创建模式不提供。 */
  readonly task?: TaskMainviewItem;
  /** 当前可绑定的全部 Workspace。 */
  readonly workspaces: readonly TaskMainviewWorkspace[];
  /** 表单提交或取消期间是否禁止继续操作。 */
  readonly busy: boolean;
  /** 当前提交错误。 */
  readonly error: string;
  /** 宿主提供的统一表单与反馈组件。 */
  readonly components: Pick<
    PluginRendererUiComponents,
    "Button" | "Callout" | "Field" | "Input" | "Page" | "Select" | "Stack" | "Switch" | "Textarea" | "Toolbar"
  >;
  /** 用户取消创建或编辑时的回调。 */
  readonly on_cancel: () => void;
  /** 用户提交合法表单时的异步回调。 */
  readonly on_submit: (draft: TaskMainviewEditorDraft) => Promise<void>;
}
