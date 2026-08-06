/** Fedman 管理员登录页。 */

import { useState, type FormEvent } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Spinner,
  ThemeContainer,
} from "@downcity/ui";
import { CircleAlertIcon, LockKeyholeIcon } from "lucide-react";
import { request_json } from "../lib/api.js";
import { error_message } from "../lib/format.js";
import type { FederationLoginResponse } from "../types/api.js";
import type { LoginPageProps } from "../types/ui.js";

/** 渲染不会泄露远端 Session Token 的本地管理员登录页。 */
export function LoginPage({ context, on_login }: LoginPageProps) {
  const [admin_id, set_admin_id] = useState(context.admin_id ?? "");
  const [password, set_password] = useState("");
  const [submitting, set_submitting] = useState(false);
  const [login_error, set_login_error] = useState("");

  async function submit_login(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!admin_id.trim() || !password) return;
    set_submitting(true);
    set_login_error("");
    try {
      await request_json<FederationLoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ admin_id: admin_id.trim(), password }),
      });
      set_password("");
      on_login();
    } catch (error) {
      set_login_error(error_message(error));
    } finally {
      set_submitting(false);
    }
  }

  return <ThemeContainer className="fedman-theme login-shell" mode="light" variant="neutral">
    <div className="login-brand"><span className="brand-mark">D</span><div><strong>Downcity</strong><small>FEDERATION MANAGER</small></div></div>
    <Card className="login-card">
      <CardHeader>
        <div className="login-icon"><LockKeyholeIcon /></div>
        <CardTitle>管理员登录</CardTitle>
        <CardDescription>使用首次部署或管理员恢复时创建的凭证。</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="login-form" onSubmit={(event) => void submit_login(event)}>
          <div className="login-target"><span>FEDERATION</span><strong>{context.federation_name}</strong><small>{context.federation_url}</small></div>
          <div className="form-field"><Label htmlFor="admin_id">管理员 ID</Label><Input id="admin_id" autoComplete="username" value={admin_id} onChange={(event) => set_admin_id(event.target.value)} placeholder="admin_..." /></div>
          <div className="form-field"><Label htmlFor="admin_password">密码</Label><Input id="admin_password" autoComplete="current-password" type="password" value={password} onChange={(event) => set_password(event.target.value)} /></div>
          {login_error ? <Alert variant="destructive"><CircleAlertIcon /><div><AlertTitle>登录失败</AlertTitle><AlertDescription>{login_error}</AlertDescription></div></Alert> : null}
          <Button disabled={submitting || !admin_id.trim() || !password} type="submit" variant="primary">
            {submitting ? <Spinner data-icon="inline-start" /> : <LockKeyholeIcon data-icon="inline-start" />}
            {submitting ? "正在验证" : "登录 Federation"}
          </Button>
        </form>
      </CardContent>
    </Card>
    <p className="login-security">密码只经过本机控制面转发；管理会话保留在当前 fed web 进程内。</p>
  </ThemeContainer>;
}
