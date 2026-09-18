/**
 * Desktop Agent 头像组件，统一处理自定义头像与默认图标回退。
 *
 * ## 形状由本组件拥有，调用点只能改尺寸
 *
 * 头像的圆角是 **比例**（`rounded-avatar` = 25%）而不是层级令牌：同一个头像在
 * BayBar 标签里是 14px、在头像选择器里是 128px，绝对半径跨不过这个范围。
 * 详见 `styles/tokens.css` 关于形状半径的注释。
 *
 * 调用点**不要**再传圆角：曾经每个调用点各自指定，于是同一类元素出现了四种比例
 *（`size-5`→4px 20%、`size-14`→16px 29%、`size-24`→8px 8%、`size-32`→8px 6%），
 * 而且与尺寸反向。尺寸由调用点决定（它属于布局），形状由本组件决定（它属于身份）。
 *
 * ## 两个分支必须共用同一份基础类
 *
 * 这里曾经两边各写一遍：`<img>` 分支带 `rounded-md`，图标兜底分支**不带**。
 * 后果是「同一个 Agent，配了自定义头像就是圆角、没配就是直角」——
 * 只在没有自定义头像的 Agent 上显现，而那种情况容易被当成「还没设置头像」而放过。
 * 因此基础类取出来只写一次。
 */

import { TbGhost3 } from "react-icons/tb";
import type { DesktopAgentSummary } from "@common/types/DesktopApi";
import { cn } from "@/lib/utils";

/**
 * 头像基础类：尺寸、形状、裁切。
 *
 * `shrink-0` 是必要的：头像在 flex 行里不能被压扁（否则会变成椭圆）。
 */
const avatar_base_class_name = "size-4 shrink-0 rounded-avatar";

/** Agent 头像展示属性。 */
export interface AgentAvatarProps {
  /** 当前 Agent 摘要。 */
  agent: Pick<DesktopAgentSummary, "agent_id" | "avatar_url"> & { /** Agent 用户可见名称。 */ name?: string; /** 兼容临时 Group 投影。 */ model_id?: string; /** 兼容临时 Group 投影。 */ version?: string };
  /**
   * 头像尺寸样式（如 `size-8`）。
   *
   * 只传尺寸与布局相关的类，**不要传圆角**：形状由本组件统一提供。
   */
  class_name?: string;
  /** 图标样式（仅在无自定义头像时生效）。 */
  icon_class_name?: string;
}

/** 展示 Agent 自定义头像；未配置时使用默认 Ghost 图标。 */
export function AgentAvatar({ agent, class_name, icon_class_name }: AgentAvatarProps) {
  return agent.avatar_url
    ? <img src={agent.avatar_url} alt={`${agent.name || "Agent"} avatar`} className={cn(avatar_base_class_name, "object-cover", class_name)} />
    : <TbGhost3 className={cn(avatar_base_class_name, "text-muted-foreground", class_name, icon_class_name)} aria-hidden="true" />;
}
