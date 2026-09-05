/** Desktop 按业务职责组织的页面与应用组件。 */

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController } from "@/types/DesktopView";

import { CreateGroupView } from "@/features/group/CreateGroupView";

/** Group 创建页只订阅 Agent 与模型目录。 */
export function CreateGroupMainView({ controller }: { /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const models = use_desktop_selector(controller.stores.catalog, (state) => state.models);
  const models_loading = use_desktop_selector(controller.stores.catalog, (state) => state.models_loading);
  const default_model_id = use_desktop_selector(controller.stores.settings, (state) => state.settings.default_text_model_id);
  return <CreateGroupView agents={agents} models={models} models_loading={models_loading} default_model_id={default_model_id} create_group={controller.actions.create_group} />;
}
