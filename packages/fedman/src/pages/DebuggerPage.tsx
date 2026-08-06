/** Fedman 基于 Downcity UI 的受限 Service 调试页面。 */

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  CodeBlock,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Textarea,
} from "@downcity/ui";
import { CircleAlertIcon, SendIcon } from "lucide-react";
import { useState } from "react";
import { Panel } from "../components/Common.js";
import { request_json } from "../lib/api.js";
import { error_message } from "../lib/format.js";
import type { ActionResponse } from "../types/api.js";
import type { DebuggerMethod } from "../types/ui.js";

const method_items: Array<{ label: DebuggerMethod; value: DebuggerMethod }> = [
  { label: "GET", value: "GET" },
  { label: "POST", value: "POST" },
];

/** 渲染只支持 GET/POST 的本地 BFF Service 调试器。 */
export function DebuggerPage() {
  const [service_id, set_service_id] = useState("accounts");
  const [method, set_method] = useState<DebuggerMethod>("GET");
  const [path, set_path] = useState("users");
  const [body, set_body] = useState("{}");
  const [result, set_result] = useState("等待请求…");
  const [request_error, set_request_error] = useState("");
  const [requesting, set_requesting] = useState(false);

  const send_request = async () => {
    set_requesting(true);
    set_request_error("");
    try {
      const parsed_body = JSON.parse(body || "{}") as Record<string, unknown>;
      const response = await request_json<ActionResponse>("/api/actions", {
        method: "POST",
        body: JSON.stringify({ action: "service_request", payload: { service_id, path, method, body: parsed_body } }),
      });
      set_result(JSON.stringify(response.result, null, 2));
    } catch (request_failure) {
      set_request_error(error_message(request_failure));
    } finally {
      set_requesting(false);
    }
  };

  return <Panel title="Service Request" meta="LOCAL BFF"><div className="debugger-form">
    <div className="form-grid"><FormField label="Service ID"><Input value={service_id} onChange={(event) => set_service_id(event.target.value)} placeholder="accounts" /></FormField>
    <FormField label="Method"><Select items={method_items} value={method} onValueChange={(value) => set_method(value as DebuggerMethod)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{method_items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></FormField>
    <FormField className="span-2" label="Path"><Input value={path} onChange={(event) => set_path(event.target.value)} placeholder="users" /></FormField>
    <FormField className="span-2" label="JSON Body"><Textarea className="debugger-body" value={body} onChange={(event) => set_body(event.target.value)} /></FormField></div>
    <Button disabled={requesting} variant="primary" onClick={() => void send_request()}>{requesting ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}{requesting ? "请求中" : "发送请求"}</Button>
    {request_error ? <Alert variant="destructive"><CircleAlertIcon /><div><AlertTitle>请求失败</AlertTitle><AlertDescription>{request_error}</AlertDescription></div></Alert> : null}
    <CodeBlock code={result} language="json" label="Response" />
  </div></Panel>;
}
