/**
 * 首页滚动驱动的代码执行舞台。
 *
 * 代码是唯一叙事时间轴。用户向下滚动时，当前执行行、运行时节点和结果状态
 * 同步前进；组件不提供额外的点击步骤，也不依赖解释型卡片。
 */

import { useRef, useState } from "react";
import { IconArrowDown, IconCheck, IconCircle } from "@tabler/icons-react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";

const execution_code = [
  { text: 'import { Agent, Workspace } from "@downcity/agent";', group: 0 },
  { text: 'import { createOpenAI } from "@ai-sdk/openai";', group: 0 },
  { text: "", group: 0 },
  { text: "const agent = new Agent({", group: 2 },
  { text: '  id: "assistant",', group: 2 },
  { text: '  workspace: new Workspace({ path: process.cwd() }),', group: 1 },
  { text: '  model: createOpenAI().responses("gpt-5"),', group: 2 },
  { text: "});", group: 2 },
  { text: "", group: 2 },
  { text: "const session = await agent.sessions.create();", group: 3 },
  { text: 'const turn = await session.prompt({ query: "Start working" });', group: 4 },
  { text: "const result = await turn.finished;", group: 5 },
  { text: "console.log(result.text);", group: 5 },
  { text: "", group: 5 },
  { text: "await agent.dispose();", group: 6 },
] as const;

const runtime_nodes = [
  { key: "workspace", group: 1, value: "./project", accent: "#4f6f9f" },
  { key: "agent", group: 2, value: "gpt-5", accent: "#557b70" },
  { key: "session", group: 3, value: "context", accent: "#716a9f" },
  { key: "turn", group: 4, value: "query", accent: "#b45d4c" },
  { key: "result", group: 5, value: "text", accent: "#3f7d5b" },
] as const;

const execution_ranges = [0.08, 0.25, 0.43, 0.6, 0.76, 0.9, 0.98] as const;

/** 渲染滚动驱动的 Agent 代码执行过程。 */
export function HomeQuickstartSection() {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const reduce_motion = useReducedMotion();
  const section_ref = useRef<HTMLElement>(null);
  const [active_group, set_active_group] = useState(0);
  const { scrollYProgress } = useScroll({ target: section_ref, offset: ["start start", "end end"] });

  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    if (reduce_motion) return;
    const next_group = execution_ranges.findIndex((range) => progress < range);
    set_active_group(next_group === -1 ? execution_ranges.length - 1 : next_group);
  });

  const visible_group = reduce_motion ? execution_ranges.length - 1 : active_group;
  const is_zh = locale === "zh";
  const section_class_name = reduce_motion ? "relative min-h-svh overflow-hidden border-t border-line bg-background" : "relative h-[360svh] overflow-hidden border-t border-line bg-background";
  const runtime_label = is_zh ? "运行时" : "Runtime";
  const final_label = is_zh ? "下一轮从这里继续" : "The next turn starts here";

  return (
    <section ref={section_ref} id="quickstart" className={section_class_name}>
      <h2 className="sr-only">{t("quickstart.title")}</h2>
      <div className="sticky top-0 flex h-svh items-center overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-35 [background-image:radial-gradient(var(--line-strong)_0.7px,transparent_0.7px)] [background-size:24px_24px]" />
        <div className="relative mx-auto grid w-full max-w-[1320px] gap-8 px-5 py-12 md:px-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(250px,0.7fr)] lg:gap-16">
          <div className="min-w-0">
            <div className="mb-5 flex items-center justify-between px-1">
              <span className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-text-subtle">agent.ts</span>
              <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-subtle">{is_zh ? "向下滚动执行" : "Scroll to execute"}</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-line bg-[#111315] shadow-[0_30px_100px_-50px_var(--foreground)]">
              <div className="flex h-11 items-center justify-between border-b border-white/10 px-4">
                <div className="flex items-center gap-1.5" aria-hidden="true"><span className="size-2.5 rounded-full bg-[#ff6b62]/80" /><span className="size-2.5 rounded-full bg-[#f4c95d]/80" /><span className="size-2.5 rounded-full bg-[#63c174]/80" /></div>
                <span className="font-mono text-[0.65rem] text-white/35">tsx</span>
                <span className="font-mono text-[0.65rem] text-white/35">{String(visible_group + 1).padStart(2, "0")} / 07</span>
              </div>
              <pre className="overflow-x-auto p-5 font-mono text-[clamp(0.7rem,1.3vw,0.86rem)] leading-7 text-white/80 [tab-size:2] sm:p-7 md:p-9">
                <code>
                  {execution_code.map((line, line_index) => {
                    const is_active = line.group === visible_group;
                    const is_done = line.group < visible_group;
                    return (
                      <motion.span
                        key={line_index}
                        className="block min-h-7 whitespace-pre px-2"
                        initial={false}
                        animate={{ opacity: is_active || is_done || line.text === "" ? 1 : 0.22, backgroundColor: is_active ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0)" }}
                        transition={{ duration: reduce_motion ? 0 : 0.2 }}
                      >
                        <span className="mr-6 inline-block w-5 select-none text-right text-[0.65rem] text-white/20">{String(line_index + 1).padStart(2, "0")}</span>{line.text || " "}
                      </motion.span>
                    );
                  })}
                </code>
              </pre>
            </div>
          </div>

          <div className="flex min-h-[18rem] flex-col justify-center lg:min-h-0">
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-text-subtle">{runtime_label}</span>
            <div className="mt-6">
              {runtime_nodes.map((node, node_index) => {
                const is_active = visible_group >= node.group;
                const is_current = visible_group === node.group;
                return (
                  <div key={node.key} className="relative flex items-center gap-4 pb-7 last:pb-0">
                    {node_index < runtime_nodes.length - 1 ? <motion.div className="absolute left-[5px] top-5 h-full w-px origin-top bg-line-strong" animate={{ scaleY: is_active ? 1 : 0.2, opacity: is_active ? 1 : 0.45 }} /> : null}
                    <motion.span className="relative z-10 flex size-3 shrink-0 items-center justify-center rounded-full border-2 bg-background" animate={{ borderColor: is_current || is_active ? node.accent : "var(--line-strong)", scale: is_current ? 1.25 : 1 }} transition={{ duration: reduce_motion ? 0 : 0.2 }}>
                      {is_active ? <IconCheck className="size-2 text-foreground" strokeWidth={3} /> : null}
                    </motion.span>
                    <div className="min-w-0">
                      <span className={`block font-serif text-lg ${is_current ? "text-foreground" : is_active ? "text-foreground/75" : "text-text-subtle"}`}>{node.key}</span>
                      <span className={`block font-mono text-xs ${is_current ? "text-text-soft" : "text-text-subtle"}`}>{node.value}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <motion.div className="mt-8 flex items-center gap-2 font-mono text-xs text-success" animate={{ opacity: visible_group >= 5 ? 1 : 0 }}>
              <IconCircle className="size-2.5 fill-current" />
              {final_label}
            </motion.div>
          </div>
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center text-text-subtle"><IconArrowDown className={`size-4 ${reduce_motion ? "" : "animate-bounce"}`} /></div>
      </div>
    </section>
  );
}

export default HomeQuickstartSection;
