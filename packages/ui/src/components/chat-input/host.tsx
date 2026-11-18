/** 富文本输入的宿主展示桥梁；默认实现可独立工作，Context 仅在当前输入实例内有效。 */
import { createContext, useContext, useMemo, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { File, MessageSquare, X } from "lucide-react";
import type { ChatAttachmentNodeAttributes, ChatInputHost, ChatInputMember, ChatReferenceNodeAttributes } from "../../types/chat-input";
import { cn } from "../../lib/utils";
import { input_menu_item_class_name, input_menu_item_selected_class_name, input_menu_item_interaction_class_name } from "./input-controls";
import { input_messages } from "./messages";
import { local_file_reference_tag, read_local_file_reference } from "./local_file_reference";

/** 插值使用 SDK 的默认英文文案；宿主可在实例边界提供其他语言。 */
function default_translate(key: string, values?: Record<string, string | number>): string {
  const text = input_messages[key] ?? key;
  return text.replace(/\{\{?(\w+)\}?\}/g, (match, name: string) => String(values?.[name] ?? match));
}
const input_host_context = createContext<ChatInputHost>({});

/** 输入节点通过同一个实例作用域访问宿主能力。 */
export function use_chat_input_host() {
  const host = useContext(input_host_context);
  return useMemo(() => ({ ...host, translate: host.translate ?? default_translate }), [host]);
}

/** 只为一个编辑器及其 NodeView 提供能力，不创建跨会话全局状态。 */
export function ChatInputHostProvider({ host, children }: { /** 当前实例的可选宿主能力。 */ host?: ChatInputHost; /** 编辑器与节点视图。 */ children: ReactNode }) {
  return <input_host_context.Provider value={host ?? empty_host}>{children}</input_host_context.Provider>;
}
const empty_host: ChatInputHost = {};

/** 候选菜单与负责人标签共用头像。 */
export function InputAvatar({ agent, class_name }: { /** 最小成员身份。 */ agent: ChatInputMember; /** 宿主指定的尺寸。 */ class_name: string }) {
  const host = use_chat_input_host();
  return host.render_avatar?.(agent, class_name) ?? (agent.avatar_url
    ? <img src={agent.avatar_url} alt="" className={`${class_name} rounded-full object-cover`} />
    : <span aria-hidden className={`${class_name} inline-flex shrink-0 items-center justify-center rounded-full bg-surface-emphasis text-xs`}>{agent.name.slice(0, 1)}</span>);
}

/** 可访问的 Slash 候选，键盘选择由所属菜单持有。 */
export function InputMenuItem({ is_selected, className = "", ...props }: ComponentPropsWithoutRef<"button"> & { /** 当前键盘选中项。 */ is_selected?: boolean }) {
  return <button type="button" className={cn(input_menu_item_class_name, is_selected ? input_menu_item_selected_class_name : input_menu_item_interaction_class_name, className)} {...props} />;
}

/** 默认附件可查看图片或下载原文件；宿主可替换预览行为。 */
export function InputAttachment({ attachment, on_remove }: { /** 节点文件快照。 */ attachment: { /** 节点标识。 */ attachment_id: string; /** 文件名。 */ filename: string; /** MIME 类型。 */ media_type: string; /** 文件 URL。 */ url: string }; /** 移除当前节点。 */ on_remove?: () => void }) {
  const host = use_chat_input_host();
  const node: ChatAttachmentNodeAttributes = { ...attachment, data_url: attachment.url };
  return host.render_attachment?.(node, on_remove) ?? <span className="chat-reference-block"><a className="chat-reference-label" href={attachment.url} target="_blank" rel="noreferrer"><File className="size-3" />{attachment.filename}</a>{on_remove ? <button type="button" className="chat-reference-action" aria-label={host.translate("composer.remove_attachment")} onClick={on_remove}><X /></button> : null}</span>;
}

/** 默认引用可展开完整快照，不需要宿主实现消息正文。 */
export function InputReference({ reference, on_remove }: { /** 引用快照。 */ reference: ChatReferenceNodeAttributes; /** 移除当前引用。 */ on_remove?: () => void; /** 自定义删除文案。 */ remove_label?: string }) {
  const host = use_chat_input_host();
  const file = reference.tag === local_file_reference_tag ? read_local_file_reference(reference.text) : undefined;
  const Icon = file ? File : MessageSquare;
  return host.render_reference?.(reference, on_remove) ?? <span className="chat-reference-block" title={file?.file_path}><details className="min-w-0"><summary className="chat-reference-label"><Icon className="size-3" /><span className="chat-reference-title">{file?.filename || reference.source_title || reference.preview_text || reference.text.slice(0, 80)}</span></summary><span className="block max-h-64 overflow-auto whitespace-pre-wrap p-2 text-xs">{reference.text}</span></details>{on_remove ? <button type="button" className="chat-reference-action" aria-label={host.translate("composer.remove_reference")} onClick={on_remove}><X /></button> : null}</span>;
}
