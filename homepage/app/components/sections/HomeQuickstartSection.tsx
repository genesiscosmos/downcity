/**
 * 首页独立快速上手模块。
 *
 * Agent、City 与 CLI 分别展示 Harness SDK、产品化连接关系与终端工作流。
 * 本模块位于完整地图叙事之后，不参与 Hero 城市立面的滚动和交互生命周期。
 */

import { useState } from "react";
import { Link } from "react-router";
import { CodeBlock } from "@downcity/ui";
import { IconArrowRight } from "@tabler/icons-react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";

const quickstart_examples = {
  agent: {
    language: "tsx",
    label: "agent.ts",
    code: `import { Agent, Workspace } from "@downcity/agent";
import { createOpenAI } from "@ai-sdk/openai";

const agent = new Agent({
  id: "assistant",
  workspace: new Workspace({ path: process.cwd() }),
  model: createOpenAI().responses("gpt-5"),
});

try {
  const session = await agent.sessions.create();
  const turn = await session.prompt({ query: "Start working" });
  const result = await turn.finished;
  console.log(result.text);
} finally {
  await agent.dispose();
}`,
  },
  city: {
    language: "tsx",
    label: "city.ts",
    code: `import { serve } from "@hono/node-server";
import { City, Federation } from "@downcity/city";
import { Database } from "@downcity/database-sqlite";

const database = new Database({ filename: "./data.sqlite" });
const federation = new Federation({ database });

await federation.health();
serve({
  fetch: (request) => federation.fetch(request),
  port: 43127,
  hostname: "127.0.0.1",
});

const city = new City({
  federation_url: "http://127.0.0.1:43127",
  user_token: process.env.DOWNCITY_USER_TOKEN!,
});

const result = await city.ai.text({
  model: "gpt-5",
  prompt: "Hello",
});`,
  },
  cli: {
    language: "bash",
    label: "Terminal",
    code: `npm install -g downcity@latest

downcity federation use
downcity agent create .
downcity agent start --foreground`,
  },
} as const;

/** 渲染三条彼此独立、可复制的 Downcity 最短上手路径。 */
export function HomeQuickstartSection() {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const [active_tab, set_active_tab] = useState<keyof typeof quickstart_examples>("agent");
  const example = quickstart_examples[active_tab];
  const docs_paths = locale === "zh"
    ? {
        agent: "/zh/agent-sdk-docs/local-agent/quickstart",
        city: "/zh/city-sdk-docs/quickstart",
        cli: "/zh/docs/cli/overview",
      }
    : {
        agent: "/en/agent-sdk-docs/local-agent/quickstart",
        city: "/en/city-sdk-docs/quickstart",
        cli: "/en/docs/cli/overview",
      };

  return (
    <section id="quickstart" className="scroll-mt-16 border-t border-line bg-background py-20 md:py-28">
      <div className="mx-auto grid max-w-[1600px] gap-10 px-5 md:px-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start lg:gap-16 lg:px-20">
        <div className="max-w-xl">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-text-soft">
            {t("quickstart.sectionLabel")}
          </p>
          <h2 className="mt-4 font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.1] tracking-[-0.025em] text-foreground">
            {t("quickstart.title")}
          </h2>
          <p className="mt-5 text-base leading-[1.7] text-text-soft">
            {t("quickstart.description")}
          </p>

          <div className="mt-8 flex items-center gap-6 border-b border-line" role="tablist" aria-label={t("quickstart.tabsLabel")}>
            {(["agent", "city", "cli"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`home-quickstart-${tab}-tab`}
                aria-controls="home-quickstart-panel"
                aria-selected={active_tab === tab}
                onClick={() => set_active_tab(tab)}
                className={`relative pb-3 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active_tab === tab ? "text-foreground" : "text-text-soft hover:text-foreground"}`}
              >
                {tab === "agent" ? "Agent" : tab === "city" ? "City" : "CLI"}
                {active_tab === tab ? (
                  <motion.span layoutId="home-quickstart-active" className="absolute inset-x-0 -bottom-px h-px bg-foreground" transition={{ duration: 0.2 }} />
                ) : null}
              </button>
            ))}
          </div>

          <div className="mt-6 min-h-28" id="home-quickstart-panel" role="tabpanel" aria-labelledby={`home-quickstart-${active_tab}-tab`}>
            <motion.div key={active_tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
              <h3 className="text-base font-semibold text-foreground">{t(`quickstart.${active_tab}Title`)}</h3>
              <p className="mt-2 text-sm leading-6 text-text-soft">{t(`quickstart.${active_tab}Description`)}</p>
              <Link to={docs_paths[active_tab]} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t(`quickstart.${active_tab}Docs`)}
                <IconArrowRight className="size-3.5" strokeWidth={1.7} />
              </Link>
            </motion.div>
          </div>
        </div>

        <motion.div key={active_tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <CodeBlock language={example.language} label={example.label} code={example.code} className="min-h-[22rem] md:p-5 md:text-[0.8rem] md:leading-6" />
        </motion.div>
      </div>
    </section>
  );
}

export default HomeQuickstartSection;
