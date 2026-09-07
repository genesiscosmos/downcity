import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { IconArrowRight, IconCheck, IconCopy, IconPlayerPlayFilled } from "@tabler/icons-react";
import type { StartContent, StartPlatform } from "@/types/start-guide";

const START_GUIDE: Record<"zh" | "en", StartContent> = {
  zh: {
    badge: "Quick Start",
    title: "用一条最短路径，把第一个项目接入 Downcity。",
    intro:
      "先选择当前系统，完成 CLI 与本地沙箱准备，再从你已经在运行的仓库开始。",
    install_title: "选择你的系统",
    install_description: "Downcity CLI 与 microsandbox Provider 在各平台使用同一套 Sandbox 模型。首次使用 Shell 前只需初始化一次本机运行时。",
    copy_label: "复制命令",
    copied_label: "已复制",
    platforms: [
      {
        id: "macos",
        label: "macOS",
        requirement: "需要 Apple Silicon Mac 与 Node.js 22 或更高版本。",
        options: [
          {
            id: "macos-default",
            title: "安装 Downcity CLI",
            badge: "推荐",
            description: "安装 CLI，并初始化 Downcity 默认使用的 microsandbox microVM 运行时。",
            command: "npm install -g downcity\nnpx microsandbox setup\ndowncity --version",
            notes: ["每个 Workspace 拥有独立、持久的 Sandbox，项目固定挂载到 `/workspace`。"],
          },
        ],
      },
      {
        id: "linux",
        label: "Linux",
        requirement: "需要 x64 或 ARM64 Linux 与 Node.js 22 或更高版本。",
        options: [
          {
            id: "linux-default",
            title: "安装 Downcity CLI",
            badge: "推荐",
            description: "安装 CLI，并初始化 Downcity 默认使用的 microsandbox microVM 运行时。",
            command: "npm install -g downcity\nnpx microsandbox setup\ndowncity --version",
            notes: ["Sandbox 不可用时命令会明确失败，不会降级到宿主执行。"],
          },
        ],
      },
      {
        id: "windows",
        label: "Windows",
        requirement: "需要 x64 或 ARM64 Windows 与 Node.js 22 或更高版本。",
        options: [
          {
            id: "windows-default",
            title: "安装 Downcity CLI",
            badge: "推荐",
            description: "安装 CLI，并初始化 Downcity 默认使用的 microsandbox microVM 运行时。",
            command: "npm install -g downcity\nnpx microsandbox setup\ndowncity --version",
            notes: ["Shell 只有 sandbox 与需要审批的 host 两个执行目标。"],
          },
        ],
      },
    ],
    steps: [
      {
        title: "在仓库里创建 Agent",
        description: "进入真实项目目录后初始化，让规则、权限和产物落在仓库本身，而不是外部平台。",
        command: "cd /path/to/your-repo\ndowncity agent create .",
      },
      {
        title: "连接 City 并启动 Runtime",
        description: "先登录 Federation，再启动唯一的 CLI City 宿主。City 会在启动时装配全部 Agent；Agent 本身没有独立启动命令。",
        command: "city federation login\ncity on\n# 调试时以前台模式运行\ncity on --foreground",
      },
      {
        title: "选择 Session 模型",
        description: "City 或直接的 Agent Session 都可以开始对话。Session 模型选择只影响当前会话，不需要重启 City。",
        command: "city agent chat <agent_id>\n# 选择默认模型\ncity agent model <agent_id> --set <model-id>",
      },
      {
        title: "做一次健康检查",
        description: "确认服务状态、再开始接技能、渠道和自动任务。先保证边界成立，再扩展自动化。",
        command: "curl http://localhost:3000/health\ncurl http://localhost:3000/api/status",
      },
    ],
    notes: [
      "建议直接从一个真实仓库开始，不要先用玩具项目演练。",
      "先跑一个最小闭环，再接入审批、技能和更多渠道。",
      "如果团队多人协作，先确定目录边界，再讨论角色分工。",
    ],
    next_title: "继续进入文档",
    next_description: "如果这些步骤已经跑通，下一步就进入完整快速开始文档，把配置、技能与任务自动化接上。",
  },
  en: {
    badge: "Quick Start",
    title: "Connect your first project to Downcity through one shortest path.",
    intro:
      "Choose your current system, prepare the CLI and local sandbox, then start from a repository you already run.",
    install_title: "Choose your system",
    install_description: "The Downcity CLI and microsandbox Provider use one Sandbox model across platforms. Initialize the local runtime once before the first Shell command.",
    copy_label: "Copy commands",
    copied_label: "Copied",
    platforms: [
      {
        id: "macos",
        label: "macOS",
        requirement: "Requires an Apple Silicon Mac and Node.js 22 or later.",
        options: [
          {
            id: "macos-default",
            title: "Install Downcity CLI",
            badge: "Recommended",
            description: "Install the CLI and initialize the microsandbox microVM runtime used by Downcity.",
            command: "npm install -g downcity\nnpx microsandbox setup\ndowncity --version",
            notes: ["Each Workspace owns an isolated persistent Sandbox with its project mounted at `/workspace`."],
          },
        ],
      },
      {
        id: "linux",
        label: "Linux",
        requirement: "Requires x64 or ARM64 Linux and Node.js 22 or later.",
        options: [
          {
            id: "linux-default",
            title: "Install Downcity CLI",
            badge: "Recommended",
            description: "Install the CLI and initialize the microsandbox microVM runtime used by Downcity.",
            command: "npm install -g downcity\nnpx microsandbox setup\ndowncity --version",
            notes: ["If the Sandbox is unavailable, execution fails instead of falling back to the host."],
          },
        ],
      },
      {
        id: "windows",
        label: "Windows",
        requirement: "Requires x64 or ARM64 Windows and Node.js 22 or later.",
        options: [
          {
            id: "windows-default",
            title: "Install Downcity CLI",
            badge: "Recommended",
            description: "Install the CLI and initialize the microsandbox microVM runtime used by Downcity.",
            command: "npm install -g downcity\nnpx microsandbox setup\ndowncity --version",
            notes: ["Shell exposes only sandbox and approval-gated host execution targets."],
          },
        ],
      },
    ],
    steps: [
      {
        title: "Create the agent inside your repo",
        description: "Initialize inside a real project so rules, permissions, and artifacts stay in the repo instead of a separate platform.",
        command: "cd /path/to/your-repo\ndowncity agent create .",
      },
      {
        title: "Connect City and start runtime",
        description: "Import the active City session into downcity, then start the runtime. Use foreground mode only when you need live logs in the current shell.",
        command: "city federation login\ncity on\n# for debugging in the foreground\ncity on --foreground",
      },
      {
        title: "Select the Session model",
        description: "After the Agent starts, select a Federation model for the current Session. The choice is stored with Session runtime data and applies on the next turn without restarting the Agent.",
        command: "downcity agent model .\n# SSH or automation\ndowncity agent model . --session-id <session-id> --set <model-id>",
      },
      {
        title: "Run a health check",
        description: "先确认 City 宿主状态，再接入 Skills、渠道和定时任务。",
        command: "city status\ncurl http://localhost:5314/health",
      },
    ],
    notes: [
      "Start from one real repository, not a demo project.",
      "Close one minimal loop before adding approvals, skills, or extra channels.",
      "If multiple people operate the system, define folder boundaries before role split.",
    ],
    next_title: "Continue in the docs",
    next_description: "Once these steps are working, move into the full quick-start guide and connect configuration, skills, and automation.",
  },
};

/**
 * 快速开始页。
 *
 * 首屏根据客户端系统选择安装方案，安装完成后继续展示跨平台一致的 Agent 启动路径。
 */
export function StartGuideSection() {
  const { i18n } = useTranslation();
  const [selected_platform, set_selected_platform] = useState<StartPlatform>("macos");
  const [copied_option, set_copied_option] = useState<string | null>(null);
  const is_zh = i18n.language.toLowerCase().startsWith("zh");
  const content = is_zh ? START_GUIDE.zh : START_GUIDE.en;
  const platform = content.platforms.find((item) => item.id === selected_platform) ?? content.platforms[0];
  const docs_quickstart_path = is_zh ? "/zh/docs/quickstart/getting-started" : "/en/docs/quickstart/getting-started";
  const home_path = is_zh ? "/zh" : "/";

  useEffect(() => {
    set_selected_platform(detect_platform(window.navigator.userAgent));
  }, []);

  const copy_command = async (option_id: string, command: string) => {
    await navigator.clipboard.writeText(command);
    set_copied_option(option_id);
    window.setTimeout(() => set_copied_option(null), 1600);
  };

  return (
    <section className="mx-auto max-w-[1320px] px-5 py-16 md:px-8 md:py-24 lg:px-20">
      <div className="space-y-12 md:space-y-16">
        <header className="grid gap-6 lg:grid-cols-[1fr_0.9fr] lg:items-end">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-text-soft">
              {content.badge}
            </span>
            <h1 className="font-serif text-[clamp(1.875rem,4vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
              {content.title}
            </h1>
          </div>
          <div className="space-y-4 border-l border-line pl-5">
            <p className="text-base leading-[1.65] text-text-soft">{content.intro}</p>
            <div className="flex flex-wrap gap-2">
              {content.notes.map((note) => (
                <span key={note} className="inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-1 text-[0.7rem] text-text-soft">
                  {note}
                </span>
              ))}
            </div>
          </div>
        </header>

        <div className="overflow-hidden rounded-[14px] border border-line bg-card shadow-sm">
          <div className="space-y-5 border-b border-line px-5 py-6 md:px-8 md:py-8">
            <div>
              <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.06em] text-text-subtle">01 / Install</p>
              <h2 className="mt-2 text-xl font-semibold text-foreground">{content.install_title}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-soft">{content.install_description}</p>
            </div>
            <div className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface-soft p-1" role="tablist" aria-label={content.install_title}>
              {content.platforms.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={item.id === selected_platform}
                  onClick={() => set_selected_platform(item.id)}
                  className={cn(
                    "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                    item.id === selected_platform ? "bg-card text-foreground shadow-sm" : "text-text-soft hover:text-foreground"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="text-sm text-text-soft">{platform.requirement}</p>
          </div>

          <div className={cn("grid", platform.options.length > 1 && "lg:grid-cols-2")}>
            {platform.options.map((option, index) => (
              <article key={option.id} className={cn("space-y-5 px-5 py-6 md:px-8 md:py-8", index > 0 && "border-t border-line lg:border-l lg:border-t-0")}>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-foreground">{option.title}</h3>
                    {option.badge && <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-text-soft">{option.badge}</span>}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-text-soft">{option.description}</p>
                </div>
                <div className="overflow-hidden rounded-xl border border-line bg-surface-soft">
                  <pre className="overflow-x-auto px-4 py-3 font-mono text-[0.78rem] leading-6 text-foreground"><code>{option.command}</code></pre>
                  <div className="flex justify-end border-t border-line px-3 py-2">
                    <button type="button" onClick={() => void copy_command(option.id, option.command)} className="inline-flex items-center gap-2 text-xs font-medium text-text-soft transition-colors hover:text-foreground">
                      {copied_option === option.id ? <IconCheck className="size-3.5 text-success" /> : <IconCopy className="size-3.5" />}
                      {copied_option === option.id ? content.copied_label : content.copy_label}
                    </button>
                  </div>
                </div>
                <ul className="space-y-1.5 text-xs leading-relaxed text-text-soft">
                  {option.notes.map((note) => <li key={note}>• {note}</li>)}
                </ul>
              </article>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[14px] border border-line bg-card shadow-sm">
          {content.steps.map((step, index) => (
            <article
              key={step.title}
              className={cn(
                "px-5 py-6 md:px-8 md:py-8",
                index !== content.steps.length - 1 && "border-b border-line"
              )}
            >
              <div className="grid gap-5 md:grid-cols-[4rem_minmax(0,1fr)] md:gap-8">
                <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.06em] text-text-subtle">
                  {String(index + 2).padStart(2, "0")}
                </p>
                <div className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">{step.title}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-text-soft">{step.description}</p>
                  </div>
                  <pre className="block overflow-x-auto rounded-xl border border-line bg-surface-soft px-4 py-3 font-mono text-[0.78rem] leading-6 text-foreground">
                    <code>{step.command}</code>
                  </pre>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="grid gap-6 rounded-[14px] border border-line bg-card p-6 shadow-sm md:grid-cols-[1fr_auto] md:items-end md:p-8">
          <div>
            <p className="text-[0.78rem] font-medium uppercase tracking-[0.04em] text-text-soft">{content.next_title}</p>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-soft">{content.next_description}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to={docs_quickstart_path}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-76"
            >
              <IconPlayerPlayFilled className="size-3.5" />
              {is_zh ? "查看完整快速开始" : "Read Full Quick Start"}
            </Link>
            <Link
              to={home_path}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-foreground/[0.05] px-5 text-sm font-semibold text-foreground transition-colors hover:bg-foreground/[0.08]"
            >
              {is_zh ? "返回首页" : "Back Home"}
              <IconArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 根据浏览器 User-Agent 选择首次展示的平台。 */
function detect_platform(user_agent: string): StartPlatform {
  const normalized_user_agent = user_agent.toLowerCase();
  if (normalized_user_agent.includes("windows")) return "windows";
  if (normalized_user_agent.includes("macintosh") || normalized_user_agent.includes("mac os")) return "macos";
  return "linux";
}

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export default StartGuideSection;
