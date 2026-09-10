/** 历史用户消息使用 Chat Composer schema 的内联编辑表面。 */

import { useCallback, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { TbLoader2 } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { create_chat_composer_extensions } from "@/features/chat/composer/editor/chatComposerExtensions";
import { is_chat_composer_empty } from "@/features/chat/composer/editor/chatComposerCodec";
import { resolve_chat_composer_enter_action } from "@/features/chat/composer/editor/chatComposerKeymap";
import type { UserMessageRewriteEditorProps } from "@/types/ChatComponents";
import { use_translation } from "@/locales/i18n";

/** 与主 ChatInput 共享 schema、快捷键及节点视图的历史消息编辑器。 */
export function UserMessageRewriteEditor(props: UserMessageRewriteEditorProps) {
  const translate_common = use_translation("common");
  const translate_chat = use_translation("chat");
  const editor_ref = useRef<Editor | null>(null);
  const props_ref = useRef(props);
  props_ref.current = props;
  const [input_empty, set_input_empty] = useState(() => is_chat_composer_empty(props.initial_document));

  const submit = useCallback(() => {
    const document = editor_ref.current?.getJSON();
    if (!document || is_chat_composer_empty(document) || props_ref.current.submitting) return;
    props_ref.current.submit(document);
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: "end",
    extensions: create_chat_composer_extensions(),
    content: props.initial_document,
    editorProps: {
      attributes: { class: "chat-input-editor", "data-chat-input": "true", spellcheck: "true" },
      handleKeyDown: (view, event) => {
        if (event.key === "Escape" && !props_ref.current.submitting) {
          event.preventDefault();
          props_ref.current.cancel();
          return true;
        }
        const action = resolve_chat_composer_enter_action(event, view.state.doc.toJSON());
        if (action === "native" || action === "queue-paused") return false;
        event.preventDefault();
        submit();
        return true;
      },
    },
    onCreate: ({ editor: current_editor }) => { editor_ref.current = current_editor; },
    onUpdate: ({ editor: current_editor }) => { set_input_empty(is_chat_composer_empty(current_editor.getJSON())); },
    onDestroy: () => { editor_ref.current = null; },
  }, []);

  return <div className="chat-composer user-message-rewrite-editor flex min-w-0 flex-col gap-2 p-1">
    <div className="chat-composer-editor min-h-16 max-h-60 w-full overflow-y-auto p-1">
      <EditorContent editor={editor} className="chat-composer-content" />
    </div>
    {props.error ? <p className="px-1 text-right text-[0.6875rem] leading-4 text-destructive">{props.error}</p> : null}
    <div className="flex justify-end gap-2 px-1 pb-1">
      <Button disabled={props.submitting} onClick={props.cancel}>{translate_common("actions.cancel")}</Button>
      <Button variant="primary" disabled={props.submitting || input_empty} onClick={submit}>
        {props.submitting ? <TbLoader2 className="animate-spin" /> : null}
        {translate_chat(props.submitting ? "composer.sending" : "composer.send")}
      </Button>
    </div>
  </div>;
}
