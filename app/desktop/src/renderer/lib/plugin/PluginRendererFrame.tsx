/**
 * 隔离承载 Plugin 自有 Mainview 的 iframe。
 *
 * iframe 没有同源、顶层导航或 Electron 能力；它只能向父页面发送结构化 action 请求。
 */

import { useEffect, useMemo, useRef } from "react";
import type {
  PluginRendererInvokeRequest,
  PluginRendererInvokeResponse,
} from "@downcity/plugin/renderer";
import type { PluginRendererFrameProps } from "@/types/plugin/PluginRendererFrame";

/** Plugin Mainview 使用的强制内容安全策略。 */
const renderer_csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";

/** 渲染并桥接一个 Plugin Mainview。 */
export function PluginRendererFrame(props: PluginRendererFrameProps) {
  const frame_ref = useRef<HTMLIFrameElement>(null);
  const source = useMemo(
    () => inject_content_security_policy(props.renderer_html),
    [props.renderer_html],
  );

  useEffect(() => {
    const handle_message = (event: MessageEvent<unknown>) => {
      if (event.source !== frame_ref.current?.contentWindow || !is_invoke_request(event.data)) return;
      const request = event.data;
      void props.invoke(request.action_id, request.input).then(
        (result) => post_response(frame_ref.current, {
          source: "downcity_host",
          type: "invoke_result",
          request_id: request.request_id,
          success: true,
          result,
        }),
        (reason) => post_response(frame_ref.current, {
          source: "downcity_host",
          type: "invoke_result",
          request_id: request.request_id,
          success: false,
          error: reason instanceof Error ? reason.message : String(reason),
        }),
      );
    };
    window.addEventListener("message", handle_message);
    return () => window.removeEventListener("message", handle_message);
  }, [props]);

  return <iframe
    ref={frame_ref}
    title={`${props.plugin_id} / ${props.profile_id}`}
    sandbox="allow-scripts allow-forms"
    srcDoc={source}
    className="h-full min-h-0 w-full border-0 bg-background"
  />;
}

/** 把宿主 CSP 插入 Mainview 文档头部。 */
function inject_content_security_policy(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${renderer_csp}">`;
  return /<head(?:\s[^>]*)?>/iu.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/iu, (head) => `${head}${meta}`)
    : `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

/** 判断未知 postMessage 是否为 Mainview action 请求。 */
function is_invoke_request(value: unknown): value is PluginRendererInvokeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<PluginRendererInvokeRequest>;
  return request.source === "downcity_plugin"
    && request.type === "invoke"
    && typeof request.request_id === "string"
    && typeof request.action_id === "string";
}

/** 向仍存活的 Mainview 返回 action 结果。 */
function post_response(
  frame: HTMLIFrameElement | null,
  response: PluginRendererInvokeResponse,
): void {
  frame?.contentWindow?.postMessage(response, "*");
}
