/** OpenUI 消息运行时：稳定实例、原生组件库、受限动作和本地状态恢复。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Renderer, type ActionEvent } from "@openuidev/react-lang";
import type { OpenUIError } from "@openuidev/lang-core";
import type { PowerMessageComponentProps, PowerRendererDefinition } from "@downcity/city/power/react";
import type { JsonObject } from "@downcity/type";
import { PresentationResourceContext } from "./PresentationMedia.js";
import { PresentationMarkdownContext } from "./PresentationMarkdown.js";
import { PRESENTATION_LIBRARY } from "./PresentationLibrary.js";
import { parse_presentation_content } from "../OpenUICatalog.js";
import { preview_presentation_tool } from "./PresentationPreview.js";
import type { PresentationViewProps } from "../types/Presentation.js";

/** 校验协议版本，旧 json-render 历史交给宿主文字回退。 */
function PresentationMessage(props: PowerMessageComponentProps) {
  const data = props.part.data as Record<string, unknown> | null;
  if (props.part.schema_version !== 2 || !data || data.format !== "openui-lang" || data.catalog_id !== PRESENTATION_LIBRARY.id || typeof data.content !== "string") throw new Error("Unsupported Presentation version; this message requires OpenUI v2");
  return <PresentationView {...props} content={data.content} streaming={Boolean(props.preview)} />;
}

/** Renderer 身份与来源绑定；文本增量不会重挂载组件或覆盖用户状态。 */
function PresentationView(props: PresentationViewProps) {
  const { content, streaming } = props;
  const [initial_state] = useState(() => {
    const saved = props.read_state();
    return saved?.content === content && saved.values && typeof saved.values === "object" ? saved.values as JsonObject : {};
  });
  const [error, set_error] = useState("");
  const [pending, set_pending] = useState(false);
  const latest = useRef(props);
  latest.current = props;
  const values = useRef<JsonObject>(initial_state);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = useCallback(() => {
    const current = latest.current;
    if (current.streaming) return;
    const state = { content: current.content, values: values.current };
    if (new TextEncoder().encode(JSON.stringify(state)).byteLength <= 64 * 1024) current.save_state(state);
  }, []);
  useEffect(() => () => { clearTimeout(timer.current); save(); }, [save]);
  const on_state_update = useCallback((state: Record<string, unknown>) => {
    values.current = JSON.parse(JSON.stringify(state)) as JsonObject;
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 250);
  }, [save]);
  const on_action = useCallback((event: ActionEvent) => {
    if (latest.current.streaming || pending) return;
    if (event.type !== "continue_conversation") { set_error("This action is not available in Presentation"); return; }
    const parameters = { ...values.current, ...(event.formState ?? {}), ...(event.params?.context === undefined ? {} : { context: event.params.context }) } as JsonObject;
    if (new TextEncoder().encode(JSON.stringify(parameters)).byteLength > 16 * 1024) { set_error("Parameters exceed 16 KiB"); return; }
    set_pending(true); set_error("");
    void latest.current.submit({ question: event.humanFriendlyMessage || "解释当前结果", parameters })
      .catch((reason) => set_error(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => set_pending(false));
  }, [pending]);
  const on_error = useCallback((errors: OpenUIError[]) => {
    const failure = errors.filter((item) => item.severity !== "warning");
    if (failure.length) set_error(failure.slice(0, 3).map((item) => item.message).join("; "));
  }, []);
  // 正式内容必须完整校验；预览只接收已通过局部检查的前缀。
  useMemo(() => parse_presentation_content(content, !streaming), [content, streaming]);
  return <section className="downcity-openui" aria-busy={streaming || pending}>
    {streaming && <p className="text-xs text-muted-foreground" role="status">正在生成可视化…</p>}
    {/* disabled 只冻结表单操作；inert 会连正文选择与辅助技术访问一起禁用。 */}
    <fieldset disabled={streaming || pending} className="downcity-presentation-controls">
      <PresentationResourceContext.Provider value={props.resolve_resource}><PresentationMarkdownContext.Provider value={props.render_markdown}><Renderer library={PRESENTATION_LIBRARY} response={content} isStreaming={streaming} initialState={initial_state} onStateUpdate={on_state_update} onAction={on_action} onError={on_error} /></PresentationMarkdownContext.Provider></PresentationResourceContext.Provider>
    </fieldset>
    {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
  </section>;
}

/** 消息与预览共享同一组件和目录。 */
export const PRESENTATION_POWER_RENDERER: PowerRendererDefinition = { message: PresentationMessage, preview: preview_presentation_tool };
