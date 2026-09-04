/** Chat Plugin 使用宿主 UI Components 的唯一 React Mainview。 */

import { useCallback, useEffect, useState } from "react";
import type { PluginJsonValue } from "@downcity/city/plugin";
import { define_plugin_renderer } from "@downcity/city/plugin/react";
import type {
  ChatPluginPublicChannelConfig,
  ChatPluginPublicProfile,
  ChatPluginPublicQueueConfig,
} from "@/chat/types/ChatPluginProfile.js";
import type { ChatPluginChannelEditorProps } from "@/chat/types/ChatPluginRenderer.js";

const channel_types: readonly ChatPluginPublicChannelConfig["type"][] = ["telegram", "feishu", "qq"];

/** Chat Plugin 的 Profile 配置界面。 */
export const CHAT_PLUGIN_RENDERER = define_plugin_renderer({ config: function ChatPluginRenderer({ config: config_gateway, ui }) {
  const { Button, Callout, EmptyState, Group, Input, LoadingState, Page, Row, Section, Select, Stack, Switch, Toolbar } = ui.components;
  const [profile, set_profile] = useState<ChatPluginPublicProfile>();
  const [loading, set_loading] = useState(true);
  const [saving, set_saving] = useState(false);
  const [error, set_error] = useState("");

  const load = useCallback(async () => {
    set_loading(true);
    set_error("");
    try {
      set_profile(await config_gateway.invoke("profile.read") as unknown as ChatPluginPublicProfile);
    } catch (reason) {
      set_error(to_error_message(reason));
    } finally {
      set_loading(false);
    }
  }, [config_gateway]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!profile) return;
    set_saving(true);
    set_error("");
    try {
      const saved = await config_gateway.invoke("profile.save", profile as unknown as PluginJsonValue);
      set_profile(saved as unknown as ChatPluginPublicProfile);
      ui.toast({ type: "success", message: "Chat Profile 已保存" });
    } catch (reason) {
      const message = to_error_message(reason);
      set_error(message);
      ui.toast({ type: "error", message });
    } finally {
      set_saving(false);
    }
  };

  const update_queue = (key: keyof ChatPluginPublicQueueConfig, value: string) => {
    set_profile((current) => current ? {
      ...current,
      queue: {
        ...current.queue,
        [key]: value === "" ? undefined : Number(value),
      },
    } : current);
  };

  const add_channel = () => {
    if (!profile) return;
    const used_types = new Set(profile.channels.map((channel) => channel.type));
    const type = channel_types.find((item) => !used_types.has(item));
    if (!type) {
      ui.toast({ type: "info", message: "每种 Channel 类型只能配置一次" });
      return;
    }
    set_profile((current) => current ? {
      ...current,
      channels: [...current.channels, { id: "", name: "", type, secret_configured: false }],
    } : current);
  };

  if (loading && !profile) return <LoadingState label="正在读取 Chat Profile…" />;

  return <Page>
    <Toolbar
      actions={<Button variant="primary" disabled={!profile || saving} on_click={() => void save()}>{saving ? "保存中…" : "保存"}</Button>}
    />
    {error ? <Callout tone="danger">{error}</Callout> : null}
    <Section title="Queue" description="控制入站消息的并发与合并等待。" surface={false}>
      <Group>
        <Row label="Maximum concurrency" trailing={<Input type="number" value={number_value(profile?.queue.max_concurrency)} minimum={1} maximum={32} placeholder="4" on_value_change={(value) => update_queue("max_concurrency", value)} />} />
        <Row label="Merge debounce" description="连续消息停止到达后等待的毫秒数。" trailing={<Input type="number" value={number_value(profile?.queue.merge_debounce_ms)} minimum={0} maximum={60000} on_value_change={(value) => update_queue("merge_debounce_ms", value)} />} />
        <Row label="Maximum merge wait" description="一组消息允许等待合并的最大毫秒数。" trailing={<Input type="number" value={number_value(profile?.queue.merge_max_wait_ms)} minimum={0} maximum={120000} on_value_change={(value) => update_queue("merge_max_wait_ms", value)} />} />
      </Group>
    </Section>
    <Section title="Channels" description="同一种 Channel 类型在一个 Profile 中只能出现一次。" action={<Button on_click={add_channel}>添加 Channel</Button>} surface={false}>
      {!profile?.channels.length ? <EmptyState title="还没有消息渠道" description="添加 Telegram、Feishu 或 QQ Channel。" action={<Button variant="primary" on_click={add_channel}>添加 Channel</Button>} size="compact" />
        : <Stack>{profile.channels.map((channel, index) => <ChannelEditor
          key={`${channel.type}:${index}`}
          channel={channel}
          used_types={new Set(profile.channels.filter((_item, item_index) => item_index !== index).map((item) => item.type))}
          components={{ Button, Group, Input, Row, Select, Switch }}
          update={(next) => set_profile((current) => current ? { ...current, channels: current.channels.map((item, item_index) => item_index === index ? next : item) } : current)}
          remove={() => set_profile((current) => current ? { ...current, channels: current.channels.filter((_item, item_index) => item_index !== index) } : current)}
        />)}</Stack>}
    </Section>
  </Page>;
} });

/** 编辑一个具体 Channel，凭据输入只保存在当前草稿。 */
function ChannelEditor({ channel, used_types, components, update, remove }: ChatPluginChannelEditorProps) {
  const { Button, Group, Input, Row, Select, Switch } = components;
  const set_string = (key: "id" | "name" | "bot_token" | "app_id" | "app_secret" | "domain", value: string) => update({ ...channel, [key]: value });
  const type_options = channel_types.map((type) => ({ value: type, label: channel_type_label(type), disabled: used_types.has(type) }));
  return <Group label={channel.name || channel.id || channel_type_label(channel.type)} action={<Button variant="destructive" on_click={remove}>删除</Button>}>
    <Row label="Type" trailing={<Select value={channel.type} options={type_options} on_value_change={(value) => update({ id: channel.id, name: channel.name, type: value as ChatPluginPublicChannelConfig["type"], secret_configured: false })} />} />
    <Row label="Channel ID" trailing={<Input value={channel.id} on_value_change={(value) => set_string("id", value)} />} />
    <Row label="Name" trailing={<Input value={channel.name} on_value_change={(value) => set_string("name", value)} />} />
    {channel.type === "telegram" ? <Row label="Bot Token" description={secret_description(channel)} trailing={<Input type="password" value={channel.bot_token ?? ""} placeholder={secret_placeholder(channel)} on_value_change={(value) => set_string("bot_token", value)} />} /> : <>
      <Row label="App ID" trailing={<Input value={channel.app_id ?? ""} on_value_change={(value) => set_string("app_id", value)} />} />
      <Row label="App Secret" description={secret_description(channel)} trailing={<Input type="password" value={channel.app_secret ?? ""} placeholder={secret_placeholder(channel)} on_value_change={(value) => set_string("app_secret", value)} />} />
      {channel.type === "feishu" ? <Row label="API Domain" trailing={<Input value={channel.domain ?? ""} placeholder="https://open.feishu.cn" on_value_change={(value) => set_string("domain", value)} />} /> : null}
      {channel.type === "qq" ? <Row label="Sandbox" trailing={<Switch checked={channel.sandbox === true} on_checked_change={(sandbox) => update({ ...channel, sandbox })} aria_label="QQ Sandbox" />} /> : null}
    </>}
  </Group>;
}

/** 返回 Channel 类型的用户可见名称。 */
function channel_type_label(type: ChatPluginPublicChannelConfig["type"]): string {
  if (type === "telegram") return "Telegram";
  if (type === "feishu") return "Feishu / Lark";
  return "QQ";
}

/** 把可选数字转换为受控 Input 字符串。 */
function number_value(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

/** 已配置凭据的安全说明。 */
function secret_description(channel: ChatPluginPublicChannelConfig): string | undefined {
  return channel.secret_configured ? "已有凭据不会显示；留空会保留当前值。" : undefined;
}

/** 已配置凭据的安全占位符。 */
function secret_placeholder(channel: ChatPluginPublicChannelConfig): string | undefined {
  return channel.secret_configured ? "已配置；留空保持" : undefined;
}

/** 把未知失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
