/** Remote 应用壳：统一品牌、语言、主题与连接生命周期，保持对话界面信息克制。 */
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { TooltipProvider } from "@downcity/ui";
import { Connect_page } from "./components/connect_page";
import { Remote_workspace } from "./components/remote_workspace";
import { use_remote } from "./lib/use_remote";
import type { Remote_locale } from "./types/remote";

/** 主题默认跟随系统，可在当前标签页内切换；语言默认跟随浏览器。 */
export function Remote_app() {
  const controller = use_remote();
  const [locale, set_locale] = useState<Remote_locale>(() => navigator.language.startsWith("zh") ? "zh" : "en");
  const [dark, set_dark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const text = (en: string, zh: string) => locale === "zh" ? zh : en;
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.documentElement.classList.toggle("dark", dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#171717" : "#fafafa");
  }, [locale, dark]);

  return <TooltipProvider><div className="remote-app" data-connected={Boolean(controller.state.city_url)}>
    <header className="site-header">
      <a className="brand" href="https://downcity.ai" aria-label="Downcity homepage"><img src="/icon.png" alt="" width="30" height="30" /><span>Downcity<span className="brand-divider">/</span><span className="brand-product">Remote</span></span></a>
      <div className="site-actions"><a href={`https://downcity.ai/${locale === "zh" ? "zh/" : ""}docs/remote`} target="_blank" rel="noreferrer">{text("Guide", "使用指南")}</a><button className="text-button" onClick={() => set_locale(locale === "en" ? "zh" : "en")} aria-label={text("Switch to Chinese", "切换到英文")}>{locale === "en" ? "中文" : "EN"}</button><button className="icon-button" onClick={() => set_dark(value => !value)} aria-label={dark ? text("Use light theme", "使用浅色主题") : text("Use dark theme", "使用深色主题")}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div>
    </header>
    {controller.state.city_url ? <Remote_workspace controller={controller} locale={locale} /> : <><Connect_page locale={locale} busy={controller.state.busy} error={controller.state.error} on_connect={controller.connect} /><footer className="connect-footer"><span>{text("Your City. Your agents. Your conversations.", "你的 City，你的 Agent，你的对话。")}</span><a href="https://github.com/wangenius/downcity" target="_blank" rel="noreferrer">{text("Open source", "开源代码")}<span aria-hidden="true">↗</span></a></footer></>}
  </div></TooltipProvider>;
}
