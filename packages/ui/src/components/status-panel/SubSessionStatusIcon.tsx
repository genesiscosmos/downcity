/** 子会话状态图标；只表达运行状态，不依赖宿主侧栏或通知 store。 */
import { TbAlertTriangle, TbHierarchy2, TbLoader2, TbMessageQuestion } from "react-icons/tb";
import type { SubSessionStatusIconProps } from "../../types/status-panel";
import { use_control_translation } from "../../lib/control-messages";
/** 为列表提供一致的状态与可访问名称。 */
export function SubSessionStatusIcon({ status, translate: translate_override }: SubSessionStatusIconProps) {
  const inherited = use_control_translation("chat");
  const translate = (key: string) => translate_override?.(`chat:${key}`) ?? inherited(key);
  const label = translate(status === "working" ? "conversation.responding" : status === "action_required" ? "attention.needs_input" : status === "failed" ? "attention.failed" : "attention.completed");
  if (status === "idle") return <TbHierarchy2 aria-hidden="true" className="size-3.5 text-muted-foreground" />;
  if (status === "completed") return <span role="img" aria-label={label} title={label} className="size-1.5 rounded-full bg-blue-500" />;
  const Icon = status === "working" ? TbLoader2 : status === "action_required" ? TbMessageQuestion : TbAlertTriangle;
  return <Icon aria-label={label} title={label} role="img" className={`size-3.5 ${status === "working" ? "animate-spin text-primary motion-reduce:animate-none" : status === "failed" ? "text-red-500 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`} />;
}
