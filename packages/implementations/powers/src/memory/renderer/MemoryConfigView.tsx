/** Memory Power 配置页：知识后端、语义处理和后台整理分别归属，Profile 独立管理。 */
import { useEffect, useState } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { MemoryConfigSnapshot } from "../types/MemoryManagement.js";

/** Sidebar 和 Provider 页共用无范围的状态读取契约，卸载后忽略迟到响应。 */
export function use_memory_config({ power, ui }: Pick<PowerMainviewComponentProps, "power" | "ui">) {
  const [snapshot, set_snapshot] = useState<MemoryConfigSnapshot>();
  const [error, set_error] = useState("");
  useEffect(() => {
    let disposed = false;
    set_error("");
    void power.invoke<MemoryConfigSnapshot>("memory.config.snapshot")
      .then((value) => { if (!disposed) set_snapshot(value); })
      .catch((reason) => { if (!disposed) set_error(reason instanceof Error ? reason.message : String(reason)); });
    return () => { disposed = true; };
  }, [power, ui.revision]);
  return { snapshot, error };
}

/** Provider 当前显示名称，未知实现保留宿主提供的名称。 */
export function provider_label(name: string): string { return name === "builtin" ? "Builtin" : name; }

/** 状态文字与实际生命周期一致，不用记忆数量判断 Provider 是否可用。 */
export function provider_state_label(state: string): string {
  return ({ ready: "就绪", degraded: "降级", unavailable: "不可用" } as Record<string, string>)[state] ?? state;
}

/** 默认 Provider 页只展示真实可用能力和当前配置边界。 */
export function memory_config_view(props: PowerMainviewComponentProps) {
  const { ui } = props;
  const { Button, Callout, Group, Inline, LoadingState, Page, Row, Status, Toolbar } = ui.components;
  const { snapshot, error } = use_memory_config(props);
  if (!snapshot) return <Page>{error
    ? <Callout tone="danger">{error}</Callout>
    : <LoadingState label="正在读取 Memory 配置…" />}</Page>;
  const { status } = snapshot.knowledge;
  const capabilities = [
    ["保存知识", status.capabilities.remember], ["检索知识", status.capabilities.recall],
    ["读取知识", status.capabilities.read], ["枚举知识", status.capabilities.list],
    ["遗忘知识", status.capabilities.forget], ["事务提交", status.capabilities.transactions],
  ] as const;
  const storage = status.details?.storage_adapter;
  return <Page>
    <Toolbar title="设置" description="知识后端与记忆处理" actions={<Inline>
      <Button on_click={ui.invalidate}>刷新</Button>
    </Inline>} />
    {error ? <Callout tone="danger">{error}</Callout> : null}
    {status.warnings?.map((warning) => <Callout key={warning} tone="warning">{warning}</Callout>)}
    <Group label="知识后端">
      <Row label="后端配置" description="由宿主创建和管理；当前仅提供 Builtin，界面不提供切换。" />
      <Row label="当前实现" trailing={<Status>{provider_label(status.provider)}</Status>} />
      <Row label="运行状态" trailing={<Status tone={status.state === "ready" ? "success" : "warning"}>{provider_state_label(status.state)}</Status>} />
      <Row label="存储实现" description={typeof storage === "string" ? storage : "未提供"} />
      <Row label="共享存储" trailing={<Status>{status.details?.city_memory_available === true ? "已接入" : "未接入"}</Status>} />
    </Group>
    <Group label="能力">
      {capabilities.map(([label, supported]) => <Row key={label} label={label}
        trailing={<Status tone={supported ? "success" : "muted"}>{supported ? "支持" : "不支持"}</Status>} />)}
      {status.provider === "builtin" ? <>
        <Row label="知识检索" description="分词与文本匹配，按相关性返回知识片段。" />
      </> : null}
    </Group>
    <Group label="记忆处理">
      <Row label="执行 Agent" description={snapshot.processing.execution_agent_id || "使用请求所属 Agent"} />
      <Row label="模型配置" description="在执行 Agent 设置中选择模型。" />
      <Row label="处理方式" description="专用 Memory Session 提炼与修订，提交结果由 Power 确认。" />
      <Row label="核心记忆" description="当前有效持续约定的完整投影，新会话加载，已有会话逐轮更正。" />
    </Group>
    <Group label="自动整理">
      <Row label="用户记忆" description="通过明确保存与修订维护；后台整理不会自动写入用户记忆。" />
    </Group>
  </Page>;
}
