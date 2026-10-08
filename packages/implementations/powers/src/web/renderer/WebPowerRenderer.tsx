/**
 * Web Power 的功能工作区。
 *
 * 侧栏按能力组织：能力是可展开的分支，展开后列出它的 Provider。展开状态与选中状态
 * 相互独立，各能力互不影响——用户有权同时展开多个，也有权收起自己正在看的那一项。
 *
 * 所有视觉都来自宿主注入的 `ui.components`：Power 只组合组件，不写样式类名。
 * 契约里没有的视觉（如状态圆点）就不做，而不是自己拼一个。
 *
 * 关闭能力不是「选一个 Provider」，因此不放进 Provider 列表——它在能力页里用开关表达。
 *
 * 配置是 Power 级的单一存储，与 Agent / Workspace 无关，因此工作区不提供执行范围选择。
 * 界面不回显 API Key，也不自行推断可用性。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { define_power_renderer } from "@downcity/city/power/react";
import type { WebMainviewSnapshot } from "@/web/types/WebMainview.js";
import {
  CONFIGURED_CAPABILITIES,
  PROVIDER_FIELD,
  PROVIDER_OPTIONS,
  capability_tag,
  is_provider_ready,
  read_capability,
  read_selected_provider,
  to_config_patch_json,
  to_error_message,
  web_route,
  type WebConfiguredCapability,
} from "@/web/renderer/WebPowerShared.js";
import { WebCapabilityView } from "@/web/renderer/WebCapabilityView.js";
import { WebGeneralView } from "@/web/renderer/WebGeneralView.js";

/** Web Power Renderer 定义。 */
export const WEB_POWER_RENDERER = define_power_renderer({
  sidebar: function WebPowerSidebar({ power, navigation, ui }) {
    const {
      Callout, LoadingState, Sidebar, SidebarSection, SidebarTreeItem, Status, StatusDot,
    } = ui.components;
    const [snapshot, set_snapshot] = useState<WebMainviewSnapshot>();
    const [expanded_capabilities, set_expanded_capabilities] = useState<Set<string>>(new Set());
    const [saving, set_saving] = useState("");
    const [error, set_error] = useState("");
    const capability = read_capability(navigation.route.capability);
    /** 已经自动展开过的能力；见下面那个 effect 的说明。 */
    const auto_expanded_ref = useRef("");

    const load = useCallback(async () => {
      set_error("");
      try {
        set_snapshot(await power.invoke<WebMainviewSnapshot>("web.snapshot"));
      } catch (reason) {
        set_error(to_error_message(reason));
      }
    }, [power]);
    useEffect(() => { void load(); }, [load, ui.revision]);

    const toggle_capability = useCallback((target: WebConfiguredCapability) => {
      set_expanded_capabilities((current) => {
        const next = new Set(current);
        if (next.has(target)) next.delete(target);
        else next.add(target);
        return next;
      });
    }, []);

    /**
     * 选中一个能力时自动展开它，每个能力只做一次。
     *
     * 不能写成「只要没展开就展开」：那样用户收起自己正在看的能力时会立刻被弹开，
     * 表现为「这一项折叠不了」。展开是跟随选中的一次性动作，不是持续成立的不变量。
     */
    useEffect(() => {
      if (capability === "general") return;
      if (auto_expanded_ref.current === capability) return;
      auto_expanded_ref.current = capability;
      if (!expanded_capabilities.has(capability)) toggle_capability(capability);
    }, [capability, expanded_capabilities, toggle_capability]);

    /**
     * 切换一个能力的 Provider。
     *
     * 只提交改动的字段：读回完整配置再整体覆盖，会把能力页里正在编辑、
     * 尚未保存的输入一起冲掉。
     */
    const select_provider = async (target: WebConfiguredCapability, value: string) => {
      set_saving(target);
      set_error("");
      try {
        await power.invoke("web.config.save", to_config_patch_json({
          [PROVIDER_FIELD[target]]: value,
        }));
        navigation.navigate(web_route(target));
        ui.invalidate();
      } catch (reason) {
        const message = to_error_message(reason);
        set_error(message);
        ui.toast({ type: "error", message });
      } finally {
        set_saving("");
      }
    };

    if (!snapshot) return <Sidebar>{error
      ? <Callout tone="danger">{error}</Callout>
      : <LoadingState label="正在读取 Web 配置…" />}</Sidebar>;

    const config = snapshot.config;

    return <Sidebar>
      <SidebarSection label="能力">
        {CONFIGURED_CAPABILITIES.map(({ key, label }) => {
          const tag = capability_tag(config, key, snapshot[key].available);
          const selected_provider = read_selected_provider(config, key);
          const capability_expanded = expanded_capabilities.has(key);
          return <div key={key}>
            <SidebarTreeItem
              kind="branch"
              depth={0}
              label={label}
              trailing={<Status tone={tag.tone}>{tag.label}</Status>}
              active={capability === key}
              expanded={capability_expanded}
              on_toggle={() => toggle_capability(key)}
              on_select={() => navigation.navigate(web_route(key))}
            />
            {capability_expanded ? <div>
              {PROVIDER_OPTIONS[key].map((provider) => {
                const ready = is_provider_ready(config, key, provider.value);
                return <SidebarTreeItem
                  key={provider.value}
                  kind="leaf"
                  depth={1}
                  label={provider.label}
                  // 两态都有标记，否则同一列看起来像漏了。
                  trailing={<StatusDot tone={ready ? "success" : "warning"} label={ready ? "可用" : "未配置"} />}
                  active={selected_provider === provider.value}
                  disabled={saving === key}
                  on_select={() => void select_provider(key, provider.value)}
                />;
              })}
            </div> : null}
          </div>;
        })}
      </SidebarSection>
      <SidebarSection label="其它">
        <SidebarTreeItem
          kind="leaf"
          depth={0}
          label="通用"
          active={capability === "general"}
          on_select={() => navigation.navigate(web_route("general"))}
        />
      </SidebarSection>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Sidebar>;
  },

  mainview: function WebPowerMainview({ power, navigation, ui }) {
    const capability = read_capability(navigation.route.capability);
    return capability === "general"
      ? <WebGeneralView power={power} ui={ui} />
      : <WebCapabilityView power={power} ui={ui} capability={capability} />;
  },
});
