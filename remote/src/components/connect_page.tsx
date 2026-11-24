/** 连接入口：本地解析 City 连接码，用户确认后连接；记住选择由连接所有者执行。 */
import { useState } from "react";
import { decode_city_connection } from "@downcity/city/browser";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Checkbox } from "@downcity/ui";
import { inspect_city_endpoint, normalize_city_url } from "../lib/endpoint";
import type { Connect_page_props } from "../types/components";

/** 输入时仅解析，不请求网络；用户确认目标并点击连接后才访问 City。 */
export function Connect_page({ locale, busy, error, storage_notice, saved_city_url, on_connect, on_retry, on_forget }: Connect_page_props) {
  const text = (en: string, zh: string) => locale === "zh" ? zh : en;
  const [connection_code, set_connection_code] = useState("");
  const [invalid_code, set_invalid_code] = useState(false);
  const [remember, set_remember] = useState(false);
  let city_url = "";
  let requires_https = false;
  if (connection_code.trim()) {
    try {
      const endpoint = inspect_city_endpoint(decode_city_connection(connection_code).url);
      city_url = endpoint.url;
      requires_https = endpoint.requires_https;
    } catch { /* 输入尚未完整时不回显连接码或解析错误。 */ }
  }

  return <main className="connect-page">
    <section className="connect-form-section" aria-labelledby="connect-title">
      <img className="connect-island" src="/grass-island.webp" width="156" height="158" alt="" />
      <h1 id="connect-title">{text("Connect to City", "连接 City")}</h1>
      <p className="connect-instruction">{text("Paste the code shared by your City owner.", "粘贴 City 拥有者分享给你的连接码。")}</p>
      <form onSubmit={event => {
        event.preventDefault();
        try {
          const connection = decode_city_connection(connection_code);
          const url = normalize_city_url(connection.url);
          set_invalid_code(false);
          void on_connect(url, connection.token, remember);
        } catch { set_invalid_code(true); }
      }}>
        <div className="city-code-label-row"><label htmlFor="connection-code">{text("City Code", "City 连接码")}</label><a href={`https://downcity.ai/${locale === "zh" ? "zh/" : ""}docs/remote`} target="_blank" rel="noreferrer">{text("Get a City Code", "获取 City 连接码")}</a></div>
        <input className="city-code-input" id="connection-code" name="connection_code" type="password" required autoComplete="off" spellCheck={false} autoCapitalize="off" placeholder={text("City Code", "City 连接码")} value={connection_code} disabled={busy} aria-invalid={invalid_code} aria-describedby={invalid_code ? "invalid-city-code" : undefined} onBlur={() => set_invalid_code(Boolean(connection_code.trim() && !city_url))} onChange={event => { set_connection_code(event.target.value); set_invalid_code(false); }} />
        {city_url ? <p className="connection-target" role="status"><span>{text("Connect to", "连接到")}</span><strong>{city_url}</strong></p> : null}
        {invalid_code ? <p id="invalid-city-code" className="form-error" role="alert">{text("Enter a complete, valid City Code.", "请输入完整有效的 City 连接码。")}</p> : null}
        {requires_https ? <p className="form-error" role="alert">{text("This City needs a reachable HTTPS address. Ask for an HTTPS City Code.", "此 City 需要可访问的 HTTPS 地址，请索取 HTTPS City 连接码。")}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {storage_notice ? <p className="form-error" role="status">{storage_notice}</p> : null}
        <div className="remember-connection"><Checkbox id="remember-connection" name="remember_connection" className="connection-checkbox" checked={remember} disabled={busy} onCheckedChange={set_remember} aria-describedby="remember-connection-hint" /><label htmlFor="remember-connection">{text("Remember this connection", "记住此连接")}</label><p id="remember-connection-hint">{text("Save access in this browser for automatic reconnect.", "在此浏览器保存访问凭据，下次自动重连。")}</p></div>
        <button className="primary-button connect-submit" type="submit" disabled={busy || !city_url || requires_https}>{busy ? <LoaderCircle className="spin" size={17} /> : null}{busy ? text("Connecting…", "正在连接…") : text("Connect", "连接")}<ArrowRight size={17} /></button>
      </form>
      {saved_city_url ? <div className="saved-connection"><span title={saved_city_url}>{new URL(saved_city_url).host}</span><div><button className="text-button" disabled={busy} onClick={() => void on_retry()}>{text("Reconnect", "重新连接")}</button><button className="text-button" onClick={on_forget}>{text("Forget this connection", "忘记此连接")}</button></div></div> : null}
    </section>
  </main>;
}
