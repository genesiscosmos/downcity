/**
 * 首页 SDK 世界滚动叙事的多文件代码面板。
 *
 * 动画阶段自动打开对应文件；已经随叙事出现的文件可以手动回看。每个文件仍按
 * 语义块逐步增加代码，当前块使用整行背景和左侧强调线表达。
 */

import { IconArrowRight, IconCheck, IconCopy } from "@tabler/icons-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { HomeSdkCodePanelProps, HomeSdkFileKey } from "@/types/home/HomeSdkWorld";

const file_keys = ["agent", "city", "federation"] as const;
const file_names: Record<HomeSdkFileKey, string> = {
  agent: "agent.ts",
  city: "city.ts",
  federation: "federation.ts",
};
const file_first_step: Record<HomeSdkFileKey, number> = {
  agent: 0,
  city: 6,
  federation: 9,
};

const file_accent: Record<HomeSdkFileKey, { line: string; background: string }> = {
  agent: { line: "#ef725f", background: "rgba(239, 114, 95, 0.15)" },
  city: { line: "#6f96d8", background: "rgba(111, 150, 216, 0.14)" },
  federation: { line: "#9ebce8", background: "rgba(158, 188, 232, 0.13)" },
};

const plugin_accent = { line: "#4f9a98", background: "rgba(79, 154, 152, 0.2)" };

/** 返回当前叙事步骤应该自动打开的代码文件。 */
export function home_sdk_file_for_step(active_step: number): HomeSdkFileKey {
  if (active_step <= 5) return "agent";
  if (active_step <= 8) return "city";
  if (active_step >= 14) return "agent";
  return "federation";
}

/** 生成与地图语义一致的渐进代码块。 */
function create_code_groups(locale: "zh" | "en") {
  return {
    agent: [
      { key: "agent-import", start_step: 0, order: 0, lines: ['import { Agent } from "@downcity/agent";'] },
      { key: "workspace-import", start_step: 2, order: 1, lines: ['import { Workspace } from "@downcity/workspace";'] },
      { key: "plugin-import", start_step: 5, order: 2, lines: ['import { SkillPlugin } from "@downcity/plugins/skill";', 'import { TaskPlugin } from "@downcity/plugins/task";', 'import { WebPlugin } from "@downcity/plugins/web";', 'import { MemoryPlugin } from "@downcity/plugins/memory";', 'import { ImagePlugin } from "@downcity/plugins/image";', 'import { SoundPlugin } from "@downcity/plugins/sound";'] },
      { key: "embassy-import", start_step: 14, order: 3, lines: ['import { Embassy } from "@downcity/federation";'] },
      { key: "agent-create", start_step: 1, order: 10, lines: ["", "const agent = new Agent({", '  id: "repo-helper",', "});"] },
      { key: "workspace-create", start_step: 2, order: 11, lines: ["", "const workspace = new Workspace({", '  id: "project",', "  path: process.cwd(),", "});"] },
      { key: "workspace-enter", start_step: 3, order: 12, lines: ["", "const agent_workspace = agent.enter(workspace);"] },
      { key: "agent-with-plugins", start_step: 5, order: 10, replaces: "agent-create", highlight_from: 3, highlight_until: 11, lines: ["", "const agent = new Agent({", '  id: "repo-helper",', "  plugins: [", "    new SkillPlugin(),", "    new TaskPlugin(),", "    new WebPlugin(),", "    new MemoryPlugin(),", "    new ImagePlugin(),", "    new SoundPlugin(),", "  ],", "});"] },
      { key: "embassy-create", start_step: 14, order: 20, lines: ["", "const embassy = new Embassy({", '  federation_url,', "  user_token,", "});"] },
      { key: "embassy-model", start_step: 14, order: 21, lines: ["", "const catalog = await embassy.user.ai.catalog();", 'const model = catalog.get("deepseek-v4-flash");'] },
      { key: "session-create", start_step: 15, order: 30, lines: ["", "const session = await agent_workspace.sessions.create();", "await session.set({ model });"] },
      { key: "session-subscribe", start_step: 16, order: 31, lines: ["", "session.subscribe((mutation) => {", "  render_agent_message(mutation);", "});"] },
      { key: "user-prompt", start_step: 15, order: 32, lines: [`await session.prompt({ query: "${locale === "zh" ? "总结当前仓库" : "Summarize this repository"}" });`] },
    ],
    city: [
      { key: "city-import", start_step: 6, order: 0, lines: ['import { City } from "@downcity/city";'] },
      { key: "city-build", start_step: 6, order: 1, lines: ["", "const build_city = new City([builder, reviewer]);"] },
      { key: "city-research", start_step: 7, order: 2, lines: ["", "const research_city = new City([researcher, writer]);"] },
      { key: "city-operations", start_step: 8, order: 3, lines: ["", "const operations_city = new City([monitor, coordinator]);"] },
    ],
    federation: [
      { key: "federation-import", start_step: 9, order: 0, lines: ['import { AIService, Federation } from "@downcity/federation";', 'import { AccountsService, CreditsService, PaymentService } from "@downcity/services";', 'import { Database } from "@downcity/database-sqlite";'] },
      { key: "federation-create", start_step: 9, order: 10, lines: ["", 'const database = new Database({ filename: "./data.sqlite" });', "const federation = new Federation({ database });"] },
      { key: "model-service", start_step: 10, order: 11, lines: ["", "const ai = new AIService();", "ai.use(deepseek.model({", '  id: "deepseek-v4-flash",', '  upstream_model: "deepseek-chat",', '  name: "DeepSeek V4 Flash",', "}));", "federation.use(ai);"] },
      { key: "account-service", start_step: 11, order: 12, lines: ["", "federation.use(new AccountsService());"] },
      { key: "payment-service", start_step: 12, order: 13, lines: ["", "const payment = new PaymentService({ providers });", "federation.use(payment);"] },
      { key: "credits-service", start_step: 13, order: 14, lines: ["", "federation.use(new CreditsService());"] },
    ],
  } as const;
}

/** 为首页代码示例提供轻量语法着色。 */
function render_code_line(line: string) {
  const token_pattern = /(\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b(?:import|from|export|return|function|const|let|try|finally|if|throw|new|await|async|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b|\b[A-Z][A-Za-z0-9_$]*\b|\b[A-Za-z_$][A-Za-z0-9_$]*(?=\s*\())/g;
  return line.split(token_pattern).filter(Boolean).map((token, token_index) => {
    const token_class = token.startsWith("//") ? "text-[#7f877d] italic" : /^("|'|`)/u.test(token) ? "text-[#aebd9c]" : /^(import|from|export|return|function|const|let|try|finally|if|throw|new|await|async|true|false|null|undefined)$/u.test(token) ? "text-[#d28b7d]" : /^\d/u.test(token) ? "text-[#c8b795]" : /^[A-Z]/u.test(token) ? "text-[#9cafc5]" : /^[A-Za-z_$]/u.test(token) ? "text-[#c8cbc4]" : undefined;
    return <span key={token_index} className={token_class}>{token}</span>;
  });
}

/** 渲染带真实文件 Tab 的同步代码面板。 */
export function HomeSdkCodePanel({ active_step, active_file, on_file_select, locale, tabs_label, docs_path, docs_label, copy_label, copied_label }: HomeSdkCodePanelProps) {
  const reduce_motion = useReducedMotion();
  const code_scroller_ref = useRef<HTMLPreElement>(null);
  const [is_copied, set_is_copied] = useState(false);
  const code_groups = useMemo(() => create_code_groups(locale), [locale]);
  const available_groups = code_groups[active_file]
    .filter((group) => group.start_step <= active_step);
  const replaced_group_keys = new Set<string>(
    available_groups.flatMap((group) => "replaces" in group && group.replaces ? [group.replaces] : []),
  );
  const visible_groups = available_groups
    .filter((group) => !replaced_group_keys.has(group.key))
    .slice()
    .sort((left, right) => left.order - right.order);
  const current_groups = visible_groups.filter((group) => group.start_step === active_step);
  const active_group_keys = new Set(
    current_groups.length > 0
      ? current_groups.map((group) => group.key)
      : visible_groups.at(-1)
        ? [visible_groups.at(-1)!.key]
        : [],
  );
  const active_accent = active_file === "agent" && active_step >= 5 ? plugin_accent : file_accent[active_file];
  const visible_code = visible_groups.flatMap((group) => group.lines).join("\n");

  useEffect(() => {
    const scroller = code_scroller_ref.current;
    if (!scroller) return;
    window.requestAnimationFrame(() => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: reduce_motion ? "auto" : "smooth" });
    });
  }, [active_file, active_step, reduce_motion]);

  const copy_code = async () => {
    await navigator.clipboard.writeText(visible_code);
    set_is_copied(true);
    window.setTimeout(() => set_is_copied(false), 1400);
  };

  let line_number = 0;

  return (
    <article id="sdk-world-code-panel" data-file={active_file} className="flex min-h-0 min-w-0 flex-col bg-[#1b1d1b] text-[#e7e8e3]" aria-live="polite">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#1b1d1b]">
        <div className="flex h-12 min-w-0 shrink-0 items-stretch border-b border-white/10" role="tablist" aria-label={tabs_label}>
          <div className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {file_keys.map((file_key) => {
              const is_available = active_step >= file_first_step[file_key];
              const is_active = active_file === file_key;
              return (
                <button
                  key={file_key}
                  id={`sdk-file-tab-${file_key}`}
                  type="button"
                  role="tab"
                  aria-selected={is_active}
                  aria-controls="sdk-file-code"
                  disabled={!is_available}
                  className={`relative h-12 shrink-0 border-r border-white/8 px-2.5 font-mono text-[0.6rem] transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 md:px-4 md:text-[0.7rem] ${is_active ? "bg-[#252725] text-[#f3f3ef]" : is_available ? "text-white/46 hover:bg-white/5 hover:text-white/75" : "cursor-not-allowed text-white/18"}`}
                  onClick={() => on_file_select(file_key)}
                >
                  {file_names[file_key]}
                  {is_active ? <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ backgroundColor: active_accent.line }} /> : undefined}
                </button>
              );
            })}
          </div>
          <Link to={docs_path} aria-label={docs_label} title={docs_label} className="inline-flex size-12 shrink-0 items-center justify-center border-l border-white/8 text-white/55 transition-colors hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40">
            <IconArrowRight className="size-4" strokeWidth={1.6} />
          </Link>
          <button type="button" className="inline-flex size-12 shrink-0 items-center justify-center border-l border-white/8 text-white/55 transition-colors hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40" aria-label={is_copied ? copied_label : copy_label} title={is_copied ? copied_label : copy_label} onClick={() => void copy_code()}>
            {is_copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
          </button>
        </div>

        <pre ref={code_scroller_ref} id="sdk-file-code" role="tabpanel" aria-labelledby={`sdk-file-tab-${active_file}`} className="min-h-0 flex-1 overflow-auto py-6 font-mono text-[0.72rem] leading-6 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin] md:py-8 md:text-[0.78rem] md:leading-7">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.code key={active_file} layout className="block min-w-max">
              {visible_groups.map((group) => {
                const is_active = active_group_keys.has(group.key);
                return (
                  <motion.span key={group.key} layout initial={reduce_motion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce_motion ? 0 : 0.3 }} className="block">
                    {group.lines.map((line, group_line_index) => {
                      line_number += 1;
                      const is_active_line = is_active && (!('highlight_from' in group) || (group_line_index >= group.highlight_from && group_line_index < group.highlight_until));
                      return (
                        <motion.span key={`${group.key}-${group_line_index}`} layout animate={{ backgroundColor: is_active_line ? active_accent.background : "rgba(0, 0, 0, 0)" }} transition={{ duration: reduce_motion ? 0 : 0.32 }} className={`grid grid-cols-[2.85rem_minmax(0,1fr)] border-l-2 pr-6 ${is_active_line ? "text-[#f4f4f0]" : "border-transparent text-white/66"}`} style={{ borderLeftColor: is_active_line ? active_accent.line : "transparent" }}>
                          <span className="select-none pr-3 text-right text-white/22" aria-hidden="true">{line_number}</span>
                          <span className="whitespace-pre">{render_code_line(line) || " "}</span>
                        </motion.span>
                      );
                    })}
                  </motion.span>
                );
              })}
            </motion.code>
          </AnimatePresence>
        </pre>
      </div>
    </article>
  );
}

export default HomeSdkCodePanel;
