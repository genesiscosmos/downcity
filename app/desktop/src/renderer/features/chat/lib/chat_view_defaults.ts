/** Desktop 按业务职责组织的页面与应用组件。 */

import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";

import { create_chat_composer } from "@/features/chat/composer/editor/chatComposerCodec";

export const empty_items: never[] = [];

export const empty_chat_content = create_chat_composer();

/** 为 Registry 尚未完成同步的 Session 提供最小 Workspace 展示值。 */
export function create_missing_workspace(workspace_id: string): DesktopWorkspaceSummary {
  return { workspace_id, workspace_path: "", name: workspace_id, readme: "", created_at: "", updated_at: "" };
}
