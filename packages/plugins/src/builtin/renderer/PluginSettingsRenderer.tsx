/** 官方简单设置 Plugin 的统一 React Mainview 生成器。 */

import { useCallback, useEffect, useState } from "react";
import type { PluginJsonObject, PluginJsonValue } from "@downcity/plugin";
import {
  define_plugin_renderer,
  type PluginRendererComponent,
  type PluginRendererUiComponents,
} from "@downcity/plugin/react";
import type { PluginSettingField, PluginSettingsDefinition } from "@/builtin/types/PluginSettings.js";

/** 根据具体 Plugin 的字段声明创建使用宿主 UI Components 的 Mainview。 */
export function create_plugin_settings_renderer(
  definition: PluginSettingsDefinition,
): PluginRendererComponent {
  return define_plugin_renderer(function PluginSettingsRenderer({ plugin, ui }) {
    const { Button, Callout, Group, Input, LoadingState, Page, Row, Select, Switch, Toolbar } = ui.components;
    const [draft, set_draft] = useState<PluginJsonObject>();
    const [loading, set_loading] = useState(true);
    const [saving, set_saving] = useState(false);
    const [error, set_error] = useState("");

    const load = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        set_draft(await plugin.invoke<PluginJsonObject>("profile.read"));
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_loading(false);
      }
    }, [plugin]);

    useEffect(() => { void load(); }, [load]);

    const set_field = (field: PluginSettingField, value: PluginJsonValue | undefined) => {
      set_draft((current) => {
        const next = { ...(current ?? {}) };
        if (value === undefined || value === "") delete next[field.key];
        else next[field.key] = value;
        return next;
      });
    };

    const save = async () => {
      if (!draft) return;
      set_saving(true);
      set_error("");
      try {
        const saved = await plugin.invoke<PluginJsonObject>("profile.save", draft);
        set_draft(saved);
        ui.toast({ type: "success", message: "Profile 已保存" });
      } catch (reason) {
        const message = to_error_message(reason);
        set_error(message);
        ui.toast({ type: "error", message });
      } finally {
        set_saving(false);
      }
    };

    if (loading && !draft) return <LoadingState label="正在读取 Profile…" />;

    return <Page>
      <Toolbar
        actions={<Button variant="primary" disabled={!draft || saving} on_click={() => void save()}>{saving ? "保存中…" : "保存"}</Button>}
      />
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Group>{definition.fields.map((field) => <Row
        key={field.key}
        label={field.label}
        description={field.description}
        trailing={<SettingControl field={field} value={draft?.[field.key]} set_value={(value) => set_field(field, value)} components={{ Input, Select, Switch }} />}
      />)}</Group>
    </Page>;
  });
}

/** 根据字段类型选择宿主表单控件。 */
function SettingControl({ field, value, set_value, components }: {
  /** 当前字段定义。 */
  readonly field: PluginSettingField;
  /** 当前字段值。 */
  readonly value: PluginJsonValue | undefined;
  /** 写回字段值。 */
  set_value(value: PluginJsonValue | undefined): void;
  /** 当前 Mainview 使用的表单组件。 */
  readonly components: Pick<PluginRendererUiComponents, "Input" | "Select" | "Switch">;
}) {
  const { Input, Select, Switch } = components;
  if (field.type === "boolean") {
    return <Switch checked={value === true} on_checked_change={set_value} aria_label={field.label} />;
  }
  if (field.type === "select") {
    return <Select value={typeof value === "string" ? value : ""} options={field.options ?? []} on_value_change={set_value} />;
  }
  return <Input
    type={field.type === "number" ? "number" : "text"}
    value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
    minimum={field.minimum}
    maximum={field.maximum}
    on_value_change={(next_value) => set_value(field.type === "number" ? next_value === "" ? undefined : Number(next_value) : next_value)}
  />;
}

/** 把未知失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
