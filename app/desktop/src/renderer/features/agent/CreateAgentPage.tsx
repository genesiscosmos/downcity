/** Desktop 按业务职责组织的页面与应用组件。 */

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController } from "@/types/DesktopView";

import { CreateAgentView } from "@/features/agent/CreateAgentView";

/** Agent 创建页只订阅表单初始化需要的目录切片。 */
export function CreateAgentMainView({ controller }: { /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const models = use_desktop_selector(controller.stores.catalog, (state) => state.models);
  const models_loading = use_desktop_selector(controller.stores.catalog, (state) => state.models_loading);
  const plugins = use_desktop_selector(controller.stores.catalog, (state) => state.plugins);
  const default_model_id = use_desktop_selector(controller.stores.settings, (state) => state.settings.default_text_model_id);
  return <CreateAgentView models={models} models_loading={models_loading} default_model_id={default_model_id} plugins={plugins} create_agent={controller.actions.create_agent} />;
}
