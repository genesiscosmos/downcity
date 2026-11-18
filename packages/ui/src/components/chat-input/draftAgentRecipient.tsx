/** 草稿负责人标记：保存唯一的显式 Agent 选择，不参与消息正文或群聊路由。 */
import { Node, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type Editor, type NodeViewProps } from "@tiptap/react";
import { TbX } from "./input-icons";
import type { ChatInputMember } from "../../types/chat-input";
import { InputAvatar as AgentAvatar } from "./host";
import { use_chat_input_host } from "./host";


/** 与引用共用胶囊排版、基线和移除按钮；负责人名称仅展示，不触发预览。 */
function DraftAgentRecipientView({ node, deleteNode, editor }: NodeViewProps) {
  const translate = use_chat_input_host().translate;
  const name = String(node.attrs.name || node.attrs.agent_id || "");
  const remove_label = translate("composer.remove_agent_recipient");
  return <NodeViewWrapper as="span" className="inline align-baseline">
    <span contentEditable={false} className="chat-reference-block" title={`@${name}`}>
      <span className="chat-reference-label">
        <AgentAvatar agent={{ agent_id: String(node.attrs.agent_id || ""), name, avatar_url: String(node.attrs.avatar_url || "") }} class_name="size-[1em] self-center" />
        <span className="chat-reference-title">{name}</span>
      </span>
      {editor.isEditable ? <button type="button" className="chat-reference-action" onClick={deleteNode} aria-label={remove_label} title={remove_label}><TbX aria-hidden="true" /></button> : null}
    </span>
  </NodeViewWrapper>;
}

/** 从草稿文档读取显式负责人；普通文本 @ 不具有选择语义。 */
export function read_draft_agent_id(document: JSONContent | undefined): string | undefined {
  if (document?.type === "draftAgentRecipient") return String(document.attrs?.agent_id || "") || undefined;
  for (const child of document?.content ?? []) {
    const agent_id = read_draft_agent_id(child);
    if (agent_id) return agent_id;
  }
  return undefined;
}

/** 用一次事务替换所有已有负责人，保留正文、附件、引用及当前插入位置。 */
export function select_draft_agent(editor: Editor, agent: ChatInputMember, from: number, to: number): void {
  const transaction = editor.state.tr.delete(from, to);
  const positions: number[] = [];
  transaction.doc.descendants((node, position) => {
    if (node.type.name === "draftAgentRecipient") positions.push(position);
  });
  let insertion = from;
  for (const position of positions.reverse()) {
    transaction.delete(position, position + 1);
    if (position < insertion) insertion -= 1;
  }
  const recipient = editor.schema.nodes.draftAgentRecipient.create({ agent_id: agent.agent_id, name: agent.name, avatar_url: agent.avatar_url || "" });
  const parent = transaction.doc.resolve(insertion).parent;
  if (parent.inlineContent && !parent.type.spec.code) {
    transaction.insert(insertion, recipient);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertion + 1)));
  } else {
    // 自动候选可能在代码块或块选区展开，标记放在独立段落，保留代码与正文。
    const end = transaction.doc.content.size;
    transaction.insert(end, editor.schema.nodes.paragraph.create(null, recipient));
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(end + 2)));
  }
  editor.view.dispatch(transaction.scrollIntoView());
  editor.commands.focus();
}

/** 原子负责人标记可以整体删除；不接受外部 HTML 作为路由指令。 */
export const DraftAgentRecipient = Node.create({
  name: "draftAgentRecipient",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ agent_id: { default: "", rendered: false }, name: { default: "", rendered: false }, avatar_url: { default: "", rendered: false } }),
  parseHTML: () => [],
  renderHTML: ({ node }) => ["span", { class: "chat-reference-block", "data-draft-agent": "" }, `@${node.attrs.name}`],
  renderText: ({ node }) => `@${node.attrs.name}`,
  addNodeView: () => ReactNodeViewRenderer(DraftAgentRecipientView),
});
