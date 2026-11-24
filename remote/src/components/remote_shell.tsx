/** Shared Remote page shell: owns appearance only; the host owns connection state. */
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { ThemeContainer, TooltipProvider } from "@downcity/ui";
import { Connect_page } from "./connect_page";
import { Remote_workspace } from "./remote_workspace";
import type { Remote_workspace_props } from "../types/components";

/** Keeps the approved landing page intact and folds connected controls into one header. */
export function Remote_shell({ controller, locale, on_locale_change, showcase = false }: Remote_workspace_props & {
  /** Update the language owned by the live or isolated development host. */
  on_locale_change: () => void;
  /** Explicitly identify synthetic development data without claiming a City connection. */
  showcase?: boolean;
}) {
  const [dark, set_dark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const text = (en: string, zh: string) => locale === "zh" ? zh : en;
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.documentElement.classList.toggle("dark", dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#171717" : "#fafafa");
  }, [locale, dark]);
  const actions = <div className="site-actions"><a href={`https://downcity.ai/${locale === "zh" ? "zh/" : ""}docs/remote`} target="_blank" rel="noreferrer">{text("Guide", "使用指南")}</a><button className="text-button" onClick={on_locale_change} aria-label={text("Switch to Chinese", "切换到英文")}>{locale === "en" ? "中文" : "EN"}</button><button className="icon-button" onClick={() => set_dark(value => !value)} aria-label={dark ? text("Use light theme", "使用浅色主题") : text("Use dark theme", "使用深色主题")}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div>;
  return <TooltipProvider><ThemeContainer mode={dark ? "dark" : "light"} className="remote-app" data-connected={Boolean(controller.state.city_url)}>
    {controller.state.city_url ? <Remote_workspace controller={controller} locale={locale} header_actions={actions} showcase={showcase} /> : <>
      <header className="site-header">
        <a className="brand" href="https://downcity.ai" aria-label="Downcity homepage"><img src="/icon.png" alt="" width="30" height="30" /><span>Downcity<span className="brand-divider">/</span><span className="brand-product">Remote</span></span></a>
        {actions}
      </header>
      <Connect_page locale={locale} busy={controller.state.busy} error={controller.state.error} storage_notice={controller.state.storage_notice} saved_city_url={controller.state.saved_city_url} on_connect={controller.connect} on_retry={controller.retry_connection} on_forget={controller.forget_connection} />
    </>}
  </ThemeContainer></TooltipProvider>;
}
