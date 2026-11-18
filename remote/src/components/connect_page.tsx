/** 连接入口：只接受私下分享的连接码，本地解析目标，凭据仅在当前页面内存短暂持有。 */
import { useState } from "react";
import { decode_city_connection } from "@downcity/city/browser";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { normalize_city_url } from "../lib/preferences";
import type { Connect_page_props } from "../types/components";

/** 输入时仅解析，不请求网络；用户确认目标并点击连接后才访问 City。 */
export function Connect_page({ locale, busy, error, on_connect }: Connect_page_props) {
  const text = (en: string, zh: string) => locale === "zh" ? zh : en;
  const [connection_code, set_connection_code] = useState("");
  const [invalid_code, set_invalid_code] = useState(false);
  let city_url = "";
  let requires_https = false;
  if (connection_code.trim()) {
    try {
      city_url = decode_city_connection(connection_code).url;
      requires_https = window.location.protocol === "https:" && new URL(city_url).protocol === "http:";
    } catch { /* 输入尚未完整时不回显连接码或解析错误。 */ }
  }

  return <main className="connect-page">
    <section className="connect-intro">
      <p className="eyebrow">DOWNCITY REMOTE</p>
      <h1>{text("Your agents.", "你的 Agent，")}<br />{text("Within reach.", "随时对话。")}</h1>
      <p className="connect-description">{text("A conversation away, wherever you are.", "无论身在何处，打开浏览器就能继续对话。")}</p>
      <a className="subtle-link" href={`https://downcity.ai/${locale === "zh" ? "zh/" : ""}docs/remote`} target="_blank" rel="noreferrer">{text("Meet Downcity Remote", "了解 Downcity Remote")}<ArrowRight size={15} /></a>
    </section>
    <section className="connect-form-section" aria-labelledby="connect-title">
      <div className="connection-symbol" aria-hidden="true"><span /><i /><span /></div>
      <h2 id="connect-title">{text("Connect to your City", "连接你的 City")}</h2>
      <p className="form-description">{text("Paste a connection code shared with you.", "粘贴朋友或同事私下发给你的连接码。")}</p>
      <form onSubmit={event => {
        event.preventDefault();
        try {
          const connection = decode_city_connection(connection_code);
          const url = normalize_city_url(connection.url);
          set_invalid_code(false);
          set_connection_code("");
          void on_connect(url, connection.token);
        } catch { set_invalid_code(true); }
      }}>
        <label htmlFor="connection-code">{text("Connection code", "连接码")}</label>
        <input id="connection-code" name="connection_code" type="password" required autoComplete="off" spellCheck={false} autoCapitalize="off" placeholder="citycode:…" value={connection_code} disabled={busy} aria-invalid={invalid_code} aria-describedby="connection-code-note" onBlur={() => set_invalid_code(Boolean(connection_code.trim() && !city_url))} onChange={event => { set_connection_code(event.target.value); set_invalid_code(false); }} />
        {city_url ? <p className="connection-target" role="status"><span>{text("Connect to", "连接到")}</span><strong>{city_url}</strong></p> : null}
        {invalid_code ? <p className="form-error" role="alert">{text("This connection code is incomplete or invalid. Ask the sender for the complete code.", "连接码不完整或无效，请向分享者索取完整连接码。")}</p> : null}
        {requires_https ? <p className="form-error" role="alert">{text("This code uses an HTTP address. Ask the sender for a reachable HTTPS connection code.", "此连接码使用 HTTP 地址，请向分享者索取浏览器可访问的 HTTPS 连接码。")}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button connect-submit" type="submit" disabled={busy || !city_url || requires_https}>{busy ? <LoaderCircle className="spin" size={17} /> : null}{busy ? text("Connecting…", "正在连接…") : text("Connect", "连接")}<ArrowRight size={17} /></button>
      </form>
      <p id="connection-code-note" className="connection-note">{text("A connection code grants access to its authorized agents. Share it privately. It is read locally and is never saved in your browser.", "持有连接码即可访问获授权的 Agent，请私下发送。连接码仅在本地解析，不保存在浏览器中。")}</p>
      <details className="connection-help"><summary>{text("Where do I get a code?", "如何获取连接码？")}</summary><p>{text("Ask your City owner to create a connection code in Desktop’s City Remote settings. They choose the agents and expiry. Your browser must be able to reach the City address.", "请 City 的拥有者在 Desktop 的 City Remote 设置中创建连接码，选择 Agent 和有效期。你的浏览器需要能访问对应的 City 地址。")}</p></details>
    </section>
  </main>;
}
