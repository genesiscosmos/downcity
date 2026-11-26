/** Web 完整配置页：能力分类、Provider 与参数由同一工作页面管理。 */
import { define_power_renderer } from "@downcity/city/power/react";
import { WEB_ACTIVITY_RENDERER } from "@/builtin/renderer/BuiltinActivity.js";
import { CONFIGURED_CAPABILITIES, read_capability, web_route } from "./WebPowerShared.js";
import { WebCapabilityView } from "./WebCapabilityView.js";
import { WebGeneralView } from "./WebGeneralView.js";

/** 配置页保留当前能力路由，业务参数由各能力组件管理。 */
export const WEB_POWER_RENDERER = define_power_renderer({
  activity: WEB_ACTIVITY_RENDERER,
  page: function web_page({ power, navigation, ui }) {
    const { Page, Tabs } = ui.components;
    const capability = read_capability(navigation.route.capability);
    return <Page><Tabs label="Web 配置" value={capability}
      items={[...CONFIGURED_CAPABILITIES.map(({ key, label }) => ({ value: key, label })), { value: "general", label: "通用" }]}
      on_value_change={(value) => navigation.navigate(web_route(read_capability(value)))} />
      {capability === "general" ? <WebGeneralView power={power} ui={ui} /> : <WebCapabilityView key={capability} power={power} ui={ui} capability={capability} />}
    </Page>;
  },
});
