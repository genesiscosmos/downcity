/**
 * 首页 Downcity 代码导览。
 *
 * 本模块按使用者、产品开发者与服务开发者三个层级展示真实的最短使用路径。
 * 每一层都在当前页面说明领域职责并直接展示对应代码，避免访问者必须跳转文档后
 * 才能理解 CLI、Desktop、Agent、City、Federation、Embassy 与 Services 的关系。
 */

import { CodeBlock } from "@downcity/ui";
import { IconArrowRight } from "@tabler/icons-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";

const entry_groups = [
  { key: "user", number: "01", language: "bash", accent: "#557b70" },
  { key: "productDeveloper", number: "02", language: "ts", accent: "#4f6f9f" },
  { key: "serviceDeveloper", number: "03", language: "ts", accent: "#b45d4c" },
] as const;

const entry_code = {
  zh: {
    user: `npm install -g downcity

downcity federation use
downcity agent create .
downcity on
downcity agent chat <agent_id>

# Desktop 使用同一套 Agent 与 City 状态`,
    productDeveloper: `import { Agent } from "@downcity/agent";
import { City } from "@downcity/city";
import { Workspace } from "@downcity/workspace";
import { createOpenAI } from "@ai-sdk/openai";

const agent = new Agent({
  id: "assistant",
  model: createOpenAI().responses("gpt-5"),
});
const agent_workspace = agent.enter(new Workspace({
  id: "project",
  path: process.cwd(),
}));
const city = new City([agent]);

const session = await agent_workspace.sessions.create();
const turn = await session.prompt({ query: "开始工作" });
console.log((await turn.finished).text);`,
    serviceDeveloper: `import { Embassy, Federation, Service } from "@downcity/federation";

const translate = new Service({ id: "translate", name: "翻译" });
translate.action("run", async (context) => ({
  text: await translate_text(String(context.input.text ?? "")),
}));

const federation = new Federation({ database });
federation.use(translate);

const embassy = new Embassy({
  federation_url: "https://fed.example.com",
  user_token: process.env.DOWNCITY_USER_TOKEN,
});
const result = await embassy.user.service("translate")
  .action("run").invoke({ text: "你好 Downcity" });`,
  },
  en: {
    user: `npm install -g downcity

downcity federation use
downcity agent create .
downcity on
downcity agent chat <agent_id>

# Desktop uses the same Agent and City state`,
    productDeveloper: `import { Agent } from "@downcity/agent";
import { City } from "@downcity/city";
import { Workspace } from "@downcity/workspace";
import { createOpenAI } from "@ai-sdk/openai";

const agent = new Agent({
  id: "assistant",
  model: createOpenAI().responses("gpt-5"),
});
const agent_workspace = agent.enter(new Workspace({
  id: "project",
  path: process.cwd(),
}));
const city = new City([agent]);

const session = await agent_workspace.sessions.create();
const turn = await session.prompt({ query: "Start working" });
console.log((await turn.finished).text);`,
    serviceDeveloper: `import { Embassy, Federation, Service } from "@downcity/federation";

const translate = new Service({ id: "translate", name: "Translate" });
translate.action("run", async (context) => ({
  text: await translate_text(String(context.input.text ?? "")),
}));

const federation = new Federation({ database });
federation.use(translate);

const embassy = new Embassy({
  federation_url: "https://fed.example.com",
  user_token: process.env.DOWNCITY_USER_TOKEN,
});
const result = await embassy.user.service("translate")
  .action("run").invoke({ text: "Hello Downcity" });`,
  },
} as const;

/** 渲染首页三个包含真实代码的 Downcity 使用与开发入口。 */
export function HomeQuickstartSection() {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const reduce_motion = useReducedMotion();
  const [active_entry, set_active_entry] = useState<(typeof entry_groups)[number]["key"]>("user");
  const [transition_direction, set_transition_direction] = useState(1);
  const active_group = entry_groups.find((entry_group) => entry_group.key === active_entry) ?? entry_groups[0];
  const active_index = entry_groups.findIndex((entry_group) => entry_group.key === active_entry);

  const select_entry = (entry_key: (typeof entry_groups)[number]["key"]) => {
    const next_index = entry_groups.findIndex((entry_group) => entry_group.key === entry_key);
    if (next_index === active_index) return;
    set_transition_direction(next_index > active_index ? 1 : -1);
    set_active_entry(entry_key);
  };

  const handle_tab_key_down = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next_index = event.key === "Home"
      ? 0
      : event.key === "End"
        ? entry_groups.length - 1
        : (active_index + (event.key === "ArrowRight" ? 1 : -1) + entry_groups.length) % entry_groups.length;
    const next_entry = entry_groups[next_index];
    select_entry(next_entry.key);
    window.requestAnimationFrame(() => document.getElementById(`quickstart-tab-${next_entry.key}`)?.focus());
  };

  return (
    <section id="quickstart" className="scroll-mt-16 border-t border-line bg-background py-20 md:py-28">
      <div className="mx-auto max-w-[1320px] px-5 md:px-8 lg:px-20">
        <div className="max-w-3xl">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-text-soft">
            {t("quickstart.sectionLabel")}
          </p>
          <h2 className="mt-4 font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.1] text-foreground">
            {t("quickstart.title")}
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-[1.7] text-text-soft">
            {t("quickstart.description")}
          </p>
        </div>

        <div className="mt-14 overflow-hidden rounded-2xl border border-line bg-surface-muted p-2 md:p-3">
          <div className="flex items-center justify-between px-3 py-2 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-text-subtle md:px-4">
            <span>{t("quickstart.stageLabel")}</span>
            <span>{String(active_index + 1).padStart(2, "0")} / {String(entry_groups.length).padStart(2, "0")}</span>
          </div>

          <div
            className="relative grid grid-cols-3 gap-1 rounded-xl border border-line-soft bg-background p-1"
            role="tablist"
            aria-label={t("quickstart.tabsLabel")}
          >
            {entry_groups.map((entry_group) => {
              const is_active = entry_group.key === active_entry;
              return (
                <button
                  key={entry_group.key}
                  type="button"
                  id={`quickstart-tab-${entry_group.key}`}
                  role="tab"
                  aria-selected={is_active}
                  aria-controls={`quickstart-panel-${entry_group.key}`}
                  tabIndex={is_active ? 0 : -1}
                  onClick={() => select_entry(entry_group.key)}
                  onKeyDown={handle_tab_key_down}
                  className={`relative min-w-0 overflow-hidden rounded-lg px-3 py-4 text-left transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 md:py-5 ${is_active ? "text-foreground" : "text-text-subtle hover:text-foreground"}`}
                >
                  {is_active ? <motion.span layoutId="quickstart-active-tab" aria-hidden="true" className="absolute inset-0 rounded-lg bg-surface-soft shadow-sm" transition={{ duration: reduce_motion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }} /> : null}
                  <span className="relative z-10 block">
                  <span className="block font-mono text-[0.65rem] text-text-subtle">
                    {entry_group.number}
                  </span>
                  <span className="mt-2 block text-xs font-medium leading-5 sm:text-sm">
                    {t(`quickstart.entries.${entry_group.key}.audience`)}
                  </span>
                  <span className="mt-1 block truncate font-mono text-[0.65rem] leading-5 sm:text-xs">
                    {t(`quickstart.entries.${entry_group.key}.products`)}
                  </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative min-h-[28rem] overflow-hidden px-2 md:min-h-[31rem] md:px-3">
            <AnimatePresence initial={false} custom={transition_direction} mode="wait">
              <motion.article
                key={active_group.key}
                id={`quickstart-panel-${active_group.key}`}
                role="tabpanel"
                aria-labelledby={`quickstart-tab-${active_group.key}`}
                custom={transition_direction}
                initial={{ opacity: 0, x: reduce_motion ? 0 : transition_direction * 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: reduce_motion ? 0 : transition_direction * -24 }}
                transition={{ duration: reduce_motion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
                className="grid gap-8 py-10 md:py-14 lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)] lg:gap-16"
              >
                <div className="flex min-w-0 flex-col justify-between">
                  <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 lg:block">
                    <span className="font-mono text-[0.7rem] text-text-subtle">
                      {active_group.number}
                    </span>
                    <div>
                      <p className="text-xs font-medium text-text-subtle">
                        {t(`quickstart.entries.${active_group.key}.audience`)}
                      </p>
                      <h3 className="mt-2 text-xl font-semibold leading-snug text-foreground md:text-2xl">
                        {t(`quickstart.entries.${active_group.key}.title`)}
                      </h3>
                      <p className="mt-3 font-mono text-xs font-medium text-foreground">
                        {t(`quickstart.entries.${active_group.key}.products`)}
                      </p>
                      <p className="mt-5 max-w-md text-sm leading-7 text-text-soft">
                        {t(`quickstart.entries.${active_group.key}.description`)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-10 hidden items-center gap-2 font-mono text-[0.65rem] text-text-subtle lg:flex">
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: active_group.accent }} />
                    {t("quickstart.currentLayer")}
                  </div>
                </div>

                <div className="min-w-0 self-center [&_[data-slot=code-block]_button]:opacity-100 lg:[&_[data-slot=code-block]_button]:opacity-0 lg:hover:[&_[data-slot=code-block]_button]:opacity-100">
                  <CodeBlock
                    code={entry_code[locale][active_group.key]}
                    language={active_group.language}
                    label={t(`quickstart.entries.${active_group.key}.codeLabel`)}
                    className="max-h-[28rem] min-h-[16rem] p-2 text-[0.72rem] leading-5 sm:p-3 sm:text-xs sm:leading-6 md:min-h-[18rem]"
                  />
                </div>
              </motion.article>
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto border-t border-line-soft px-3 py-3 font-mono text-[0.62rem] text-text-subtle md:px-4">
            <span className="mr-2 shrink-0 uppercase tracking-[0.08em]">{t("quickstart.flowLabel")}</span>
            {entry_groups.map((entry_group, entry_index) => (
              <span key={entry_group.key} className="flex shrink-0 items-center gap-2">
                <span className={entry_group.key === active_entry ? "text-foreground" : ""}>{t(`quickstart.entries.${entry_group.key}.products`)}</span>
                {entry_index < entry_groups.length - 1 ? <IconArrowRight className="size-3.5" strokeWidth={1.4} /> : null}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default HomeQuickstartSection;
