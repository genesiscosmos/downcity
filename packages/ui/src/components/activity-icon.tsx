/** Activity 唯一的默认图标表；Power 图标可由宿主替换为真实注册事实。 */
import { TbBrain, TbArrowsMinimize, TbCommand, TbFileSearch, TbGitFork, TbMessageQuestion, TbPencil, TbPencilPlus, TbPuzzle, TbSearch, TbTextScan2, TbTerminal, TbWorld, TbMail, TbClock } from "react-icons/tb";
import type { AgentActivityVisualKind } from "../types/activity";
const icons = { reasoning: TbBrain, read: TbTextScan2, write: TbPencilPlus, edit: TbPencil, grep: TbSearch, find: TbFileSearch, ask: TbMessageQuestion, command: TbCommand, fork: TbGitFork, compaction: TbArrowsMinimize, generic: TbPuzzle, power: TbPuzzle };
const power_icons: Readonly<Record<string, typeof TbPuzzle>> = { shell: TbTerminal, web: TbWorld, email: TbMail, task: TbClock, session: TbGitFork, agent: TbGitFork };
/** 显式类型、Power 名与可选受信图标资源，不按工具名称子串猜测。 */
export function ActivityIcon({ kind, power_name, icon_url }: {
  /** canonical 投影确定的工具、动作或推理种类。 */ kind: AgentActivityVisualKind;
  /** 已确认的 Power 注册名；其他种类省略。 */ power_name?: string;
  /** 宿主授权的图标资源；缺省时使用同一份类型图标表。 */ icon_url?: string;
}) {
  if (icon_url) return <img src={icon_url} alt="" className="activity-tool-icon" />;
  const Icon = power_name ? power_icons[power_name] ?? TbPuzzle : icons[kind];
  return <Icon className="activity-tool-icon" aria-hidden />;
}
