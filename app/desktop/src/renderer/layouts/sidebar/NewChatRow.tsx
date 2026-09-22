/**
 * Workspace 根行右端的「新建对话」入口。
 *
 * ## 它在哪，以及为什么在那里
 *
 * ```text
 * [▶ 24]─4─Workspace 名                       [＋] [⋯]      ← hover 时
 * [▶ 24]─4─Workspace 名                                    ← 静止时
 * ```
 *
 * 新建对话要落在一个 Workspace 里，因此入口长在**那个 Workspace 自己的行上**：位置即作用域，
 * 不需要先展开、也不需要读说明。它排在菜单入口**左边**——「开一条新的」比「管理这个 Workspace」
 * 更常用，把常用的放外侧才不用瞄准。
 *
 * ## 为什么 hover 才显形
 *
 * 它与菜单入口是同一类东西：**对这一行做点什么**，而不是这一行的内容。侧栏的行本来就靠
 * hover / 聚焦显形它们（见 `chat_row_trigger_class_name`），一个常显的加号会在整列 Workspace
 * 右侧排出一串同样的符号，把「这一行叫什么」的注意力分走。
 *
 * 显隐只改透明度、不改布局：静止时它仍占着那个 `size-6` 的位子，因此 hover 出现时
 * 名字不会被挤动。键盘聚焦与 hover 同等对待——否则键盘用户看不到这个入口。
 *
 * ## 点它做什么
 *
 * 直接进入**当前 Workspace 的空对话主页**（`draft`）：默认联系人取该 Workspace 最近用过的
 * Agent，没有历史时回退到默认 Agent。空白页上的联系人选择器可以换 Agent——换 Agent 只改
 * 「和谁聊」，Workspace 保持不变，因此不需要再选一次目录。
 *
 * 这里不弹 Agent / Group 选择器：那一步在空白页上做得更好（那里有头像、有描述、有目录上下文），
 * 在侧栏再弹一次等于把同一个决定问两遍。
 */

import { TbPlus } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_translation } from "@/locales/i18n";

/** 「新建对话」入口属性。 */
interface NewChatButtonProps {
  /** 这个入口会落到哪个 Workspace。 */
  workspace_id: string;
  /** 该 Workspace 最近使用的 Agent；没有历史时由调用方给默认 Agent。 */
  agent_id: string;
  /** 在指定 Workspace 为指定 Agent 打开空对话。 */
  on_open_draft(workspace_id: string, agent_id: string): void;
}

/**
 * 渲染 Workspace 行右端的新建入口。
 *
 * 没有可用 Agent 时**不渲染**：那时点下去只会落进一个没有联系人的空对话，
 * 而「先创建 Agent」才是用户此刻真正要做的事——Agents 面板的空态已经给了那个出口。
 * 一个 hover 才出现的加号如果点了没反应，比看不到它更糟；
 * 这与「没有可执行的动作，胜过一个什么都不做的动作」是同一条原则。
 */
export function NewChatButton({ workspace_id, agent_id, on_open_draft }: NewChatButtonProps) {
  const translate = use_translation("navigation");
  if (!agent_id) return null;
  const label = translate("sidebar.new_chat");
  return <Button
    size="icon"
    title={label}
    aria-label={label}
    // 与菜单入口同一套显隐：静止时透明但仍占位（见文件头）。
    // 键盘用 `focus-within` 而不是 `focus-visible`：Tab 到同行的菜单按钮时，
    // 加号不能因为自己没拿到焦点就消失——它们同属“对这一行做点什么”。
    className="opacity-0 transition-opacity duration-150 group-hover/item:opacity-100 group-focus-within/item:opacity-100"
    onClick={() => on_open_draft(workspace_id, agent_id)}
  ><TbPlus /></Button>;
}
