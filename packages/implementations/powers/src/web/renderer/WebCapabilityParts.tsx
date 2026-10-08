/**
 * Web 能力视图复用的展示部件。
 *
 * 关键点（中文）：这些部件只负责渲染，不持有配置状态；保存由能力视图统一发起，
 * 因此侧栏下拉与这里提交的都是同一套字段级增量。
 *
 * 所有视觉都来自 `ui.components`：这里不写样式类名。
 */

import type { ReactNode } from "react";
import type { PowerRendererUiComponents } from "@downcity/city/power/react";
import type { WebCredentialTarget } from "@/web/types/WebPowerConfig.js";

/** 密钥输入行属性。 */
export interface WebSecretRowProps {
  /** 字段的用户可见名称。 */
  readonly label: string;
  /** 服务端记录的「已配置」状态。 */
  readonly configured: boolean;
  /** 本次准备写入的新值。 */
  readonly value: string;
  /** 用户是否已要求清除该密钥。 */
  readonly cleared: boolean;
  /** 更新新值。 */
  set_value(value: string): void;
  /** 标记为清除。 */
  clear(): void;
  /** 撤销清除。 */
  restore(): void;
  /** 该密钥对应的凭据项，用于跳转到服务商控制台。 */
  readonly target: WebCredentialTarget;
  /** 打开服务商控制台。 */
  readonly on_open_console: (target: WebCredentialTarget) => void;
  /** 宿主 UI 组件。 */
  readonly components: PowerRendererUiComponents;
}

/**
 * 密钥输入行。
 *
 * 已保存的密钥永不回显：只显示「已配置 / 未配置」，空输入表示保留旧值，
 * 删除必须走显式清除，因此不会因为一次误清空就丢掉凭据。
 *
 * 未配置时多一个「去申请」链接：用户看到要填 Key 的第一反应是「去哪拿」，
 * 而不是去搜索。链接只在还没配置时出现，已配置后不占位置。
 */
export function WebSecretRow(props: WebSecretRowProps): ReactNode {
  const { Button, Inline, Input, Link, Row, Status } = props.components;
  const status = props.cleared
    ? <Status tone="warning">保存后清除</Status>
    : props.configured ? <Status tone="success">已配置</Status> : <Status tone="muted">未配置</Status>;
  return <Row label={props.label} trailing={<Inline>
    {status}
    <Input
      type="password"
      value={props.value}
      disabled={props.cleared}
      on_value_change={props.set_value}
      placeholder={props.configured ? "输入新值以替换" : "输入 API Key"}
    />
    {props.configured ? <Button
      variant={props.cleared ? "default" : "destructive"}
      on_click={props.cleared ? props.restore : props.clear}
    >{props.cleared ? "撤销" : "清除"}</Button> : <Link
      external
      on_click={() => props.on_open_console(props.target)}
    >去申请</Link>}
  </Inline>} />;
}
