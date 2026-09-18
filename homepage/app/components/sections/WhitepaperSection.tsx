import { useState } from "react";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { IconCheck, IconCopy, IconDownload } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const INSTALL_COMMAND = "npm i -g downcity";
const WHITEPAPER_DOWNLOAD_PATH = "/agent-strategy-whitepaper-2026-03-09.md";
const WHITEPAPER_DOWNLOAD_FILENAME = "agent-strategy-whitepaper-2026-03-09.md";

/**
 * 白皮书正文模块（Vibecape 风格）。
 * 说明：
 * 1. 长文正文使用 max-w-3xl 居中，标题层级清晰。
 * 2. 保留复制安装命令、下载 Markdown、复制全文功能。
 * 3. 引用/代码块使用细线边框与柔和背景。
 */
const WHITEPAPER = {
  zh: {
    badge: "Whitepaper",
    title: "当 Agent 进入生产：人的主导权、协作关系与上下文环境",
    epigraph: "缗蛮黄鸟，止于丘隅。",
    railTitle: "核心命题",
    railBody: "Downcity 不是在业务之上再造一个抽象平台，而是把 Agent 放回你已经在使用的目录、文件与协作边界里。",
    downloadLabel: "下载 Markdown",
    copyPaperLabel: "复制全文",
    copyPaperSuccess: "已复制全文",
    copyPaperFail: "复制失败",
    commandLabel: "安装入口",
    sections: [
      {
        title: "我们真正面对的问题",
        paragraphs: [
          "这几年，业界对 Agent 的期待基本建立在一种线性进步的假设上：似乎只要底层模型持续迭代，工具链不断丰富，全自动化的终局就会自然到来。在这种叙事里，唯一的悬念只是技术指标何时达标。然而，一旦将视线从概念演示切入真实的业务现场，阻碍落地的真正矛盾立刻就会浮出水面。",
          "在复杂的生产环境中，核心命题从来不是“大模型有多聪明”，而是团队在引入这类具备一定自主性的系统后，能否继续保持对业务目标与系统边界的绝对把控。当前主流的落地方案往往带有极强的侵入性，它们暗含了一个前提，即现有的工作流必须被重构，业务状态必须向新平台迁移，以此来迎合所谓的先进范式。这种做法本质上是在用工具规训人，迫使作为主体的人去迁就系统的逻辑。团队在短期内或许获得了某种前沿的幻觉，但在长周期的迭代中，却常常陷入一个悖论：**系统的自治能力越强，业务人员对工作底座的掌控感反而越稀薄。**",
          "更底层地看，这种掌控感的稀薄，本质上源于对**“信息损耗”**的忽视。如果业界对 Agent 的终局期待是高度类人的（Human-like），那么现实中 Human 与 Human 之间固有的沟通效率瓶颈、隐性知识丢失与上下文错位，必然也会全盘映射到 Human 与 Agent 之间。",
          "当业务人员被迫离开熟悉的工作流，去抽象的平台里使用各类表单和配置去指挥 Agent 时，实质上是在本就存在的人机沟通摩擦之上，又强加了一层“系统翻译”的损耗。每一次从自然工作流向平台表单的切换，都是一次隐性上下文的衰减。**因此，能让 Human 与 Agent 之间信息交互损耗降到最低的行为模式，才是当前阶段最好的 Agent 架构设计。**它解释了为什么工具绝不应再试图规训人，而必须主动对接人的原生业务载体。",
          "Downcity 的设计哲学正是对这一悖论的修正。它拒绝要求组织为了拥抱 AI 而进行伤筋动骨的范式迁移，而是主张将主导权彻底交还给人类主体。在这里，“止”被具象化为一种严密的业务秩序：由人明确划定业务的护城河并掌握底层控制权，Agent 的角色则被严格限定在这些清晰的规则内，去释放高密度的执行力。",
        ],
      },
      {
        title: "为什么“替代叙事”在真实的复杂系统中必然失效",
        paragraphs: [
          "“替代人”是消费级 AI 最具诱惑力的叙事，但在严肃的业务现场，这却是一个工程伪命题。因为真实的业务运转绝不是一系列离散、无状态任务的简单拼接，它是一张由**连续的上下文、隐性的组织契约、异常兜底机制与责任网络**交织而成的复杂拓扑。",
          "很多平台型 Agent 方案的底层架构，本质上是在做**“状态剥离与系统封装”**：它们试图把复杂的业务环境收编进一个黑盒式的控制中枢，让 AI 在无菌的沙盒中给出“标准答案”。这种架构在短期演示中极其顺滑，但随着业务深入，必然会引发效率提升与治理能力之间的巨大“剪刀差”。",
          "当系统以“替代”为核心目标时，往往会天然地屏蔽过程逻辑。这导致业务人员逐渐丧失了对系统状态的感知力（Situation Awareness）。一旦 Agent 在陌生语境中发生幻觉或逻辑偏移，团队连纠偏的抓手都找不到，因为人类既不知道机器基于什么上下文做出了决策，也无法直接介入其黑盒化的思考链路。生产系统中最危险的，往往不是确定的错误，而是“在黑盒中发生且无法追溯的失控”。",
          "因此，严肃生产环境真正需要的架构，不是切断上下文的“Human or Agent”，而是共享上下文的**“Human with Agent”**。必须由人类来定义业务环境的物理边界，承载最终的兜底责任，而 Agent 仅作为这一确定性环境中的“高频执行器”。谁掌握了环境的解释权，谁就真正控制了系统的走向。",
        ],
      },
      {
        title: "认知同构：从“重建抽象平台”到“继承知识拓扑”",
        paragraphs: [
          "当前大多数 AI 落地项目的最大阻力，在于极高的“重置成本”。这种重置不仅是数据的搬运，更是**组织心智与认知拓扑的毁灭与重建**。",
          "在任何真实的业务团队里，最有价值的资产从来不只是孤立的数据本身，而是它们之间的**结构**：文件夹的分类习惯、协作文档的命名规则、任务状态的流转标记。一个团队长期使用的目录或工作空间，本身就是这个组织做决策、定边界、分优先级的“实体化知识图谱”。",
          "Downcity 的核心洞察在于：**最好的 Prompt 结构，就是人类已经建构好的目录结构；最好的知识库，就是人类每天都在阅读和修改的源文件。**",
          "我们拒绝把这些充满生命力的组织资产，生硬地切割并导入到另一个满是表单和向量数据库的抽象平台中。相反，我们让 Agent 直接进入人类原生工作区，去读取、理解并遵循现有的文件拓扑。团队不需要为了使用 AI 去学习一套全新的中台语言，Agent 直接继承了团队的隐性知识网络，实现真正的零摩擦冷启动。",
        ],
      },
      {
        title: "人机边界的重塑：管理文件目录，就是管理智能体",
        paragraphs: [
          "当我们放弃了宏大的“全知全能中枢”叙事，转而将 Agent 嵌入原生的文档与目录时，我们实际上完成了一次关键的人机界面范式转移。",
          "在传统 Agent 平台中，管理智能体意味着复杂的节点拖拽、参数调试和 JSON 配置，这对大多数业务人员来说都是难以跨越的认知门槛。但在这种原生贴合的架构下，我们实现了**“操作维度的降维与认知模型的同构”**。",
          "新增一个业务边界，只需新建一个文件夹；调整 Agent 规范，只需修改几句自然语言规则；审计 Agent 的中间过程，只需点开它刚刚写入目录的 Markdown 产物。",
          "“管理目录，就是管理智能体。” 这不仅是交互层面的讨巧，而是对 AI 祛魅后最深刻的技术主张。当机器状态表达与人类心智模型同构时，我们就消解了原本横亘在人与大模型之间的翻译层。",
        ],
      },
      {
        title: "真正的差异化：不在“更多功能”，在建立可持续的“关系契约”",
        paragraphs: [
          "当下的 AI 市场，功能层面的同质化几乎是必然的。但面向生产级的工具，真正的差异化护城河并不在于谁接入了更多 API，而在于**系统是否能在复杂多变的现实中，与组织建立起一种稳固且具有弹性的“人机关系契约”**。",
          "这套原生贴合的架构不追求用眼花缭乱的功能接管一切，而是恪守三条底线：主导权的绝对锚定、零绑架（Zero Lock-in）、优雅降级能力（Graceful Degradation）。",
          "这意味着业务状态始终以标准文件形式存在，即使某天你不再使用这个系统，留下的仍是一套组织良好、人类可读的业务资料；当系统遇到异常时，人类也总能像接手同事未完成工作一样继续推进。",
        ],
      },
      {
        title: "权责是基线，动态治理是长期增益",
        paragraphs: [
          "权责与审计是所有业务级 Agent 方案必须满足的门槛，但仅靠权责不足以形成长久优势。真正的核心价值，在于提供一套**可动态伸缩的渐进式自动化模型**：在低风险阶段保持极高上手速度，在高风险阶段又能平滑叠加审批、审计和版本回滚等控制点。",
          "团队可以先在熟悉的文件夹里快速跑通一个智能体闭环，再按需逐步增加治理约束，真正实现“先跑起来，再管起来”，而不是被迫“先购买重型平台，再试图验证业务价值”。",
          "在这种架构哲学下，Agent 不再是一个令人失控与敬畏的黑盒；它应该化作无形的流水，深度渗入团队原有的文档、结构与肌理中，在不强迫人类改变原生语言的前提下，默默完成业务智能的跃升。",
        ],
      },
    ],
  },
  en: {
    badge: "Whitepaper",
    title: "When Agents Enter Production: Human Control, Collaboration, and Context",
    epigraph: "Mian man huang niao, zhi yu qiu yu.",
    railTitle: "Core Thesis",
    railBody: "Downcity does not build another abstract platform above the business. It puts agents back into the folders, files, and collaboration boundaries teams already use.",
    downloadLabel: "Download Markdown",
    copyPaperLabel: "Copy Full Text",
    copyPaperSuccess: "Copied full text",
    copyPaperFail: "Copy failed",
    commandLabel: "Install Entry",
    sections: [
      {
        title: "The Problem We Actually Face",
        paragraphs: [
          "In recent years, agent discussions have converged on one narrative: stronger models, more tools, wider channels, deeper automation. It looks like the only remaining question is capability delta. But once you move from demos to production, the problem changes shape immediately.",
          "The key question is not whether models are smart enough. It is whether teams can still control goals, boundaries, and pace after adopting agents. Many systems assume the same path: rewrite process first, migrate state first, adapt to platform first, then talk about efficiency. Tools begin to define how people work, and people start adapting to the system.",
          "Downcity takes the opposite stance. Humans define goals and boundaries first, then agents amplify execution inside existing engineering context. In practical terms, people decide when to start, stop, and take over, while agents execute at high intensity within defined constraints. Instead of building a full control plane first, teams can start directly from existing repositories and close loops in familiar workflows.",
        ],
      },
      {
        title: "Why the Replacement Narrative Fails in Production",
        paragraphs: [
          "Production is not an empty field waiting for new tooling. It already includes business constraints, team habits, repository semantics, dependency graphs, quality bars, and historical decisions. Agents do not erase this terrain; they must operate within it.",
          "Collaboration boundaries come from whoever defines the environment. Platform-centric approaches often absorb the environment into the platform itself. Teams get capability, but only after migrating semantics and state. Over time this can weaken an organization’s ability to interpret and govern its own context.",
          "“Replace humans” is persuasive in consumer scenarios but usually collapses in production. Production systems are not single tasks. They are continuous processes with cross-cycle coordination, exception handling, and accountability.",
          "When replacement is the objective, systems drift toward black-box encapsulation. That can feel smooth in the short term, but it reduces process visibility. Teams eventually discover they cannot explain decisions quickly enough when something goes wrong.",
          "What production needs is not “Human or Agent,” but “Human with Agent.” Humans own direction and accountability. Agents own execution and acceleration. If that boundary is unclear, stronger automation only increases organizational risk.",
        ],
      },
      {
        title: "Start from Existing Assets, Not from Zero",
        paragraphs: [
          "Downcity’s first principle is not building another platform. It is activating the project you already run. In real teams, the most valuable assets are not just source code: they are configuration habits, collaboration conventions, historical context, task trails, and quality standards.",
          "Project Skills, global Agent configuration, and runtime artifacts in `.downcity` form a clear ownership boundary. Downcity connects these assets into a sustainable execution surface without maintaining competing configuration copies.",
        ],
      },
      {
        title: "Human Factors: Managing Folders Is Managing Agents",
        paragraphs: [
          "If production agent adoption is a human-computer system design problem, the dominant variable is not model parameters, but cognitive load. Developers are fluent in directories, files, commands, and version history. That path model is the shared language of engineering collaboration.",
          "The most effective way to reduce agent education cost is not another tutorial layer. It is embedding agents into existing engineering paths so managing directories, checking artifacts, and editing config naturally become agent-management actions.",
          "When system state and human mental models are aligned, adoption accelerates. Not because people suddenly become smarter, but because the system does not force them to change language. For individuals and small teams, this alignment is a direct productivity multiplier.",
        ],
      },
      {
        title: "The Differentiation of Downcity: Not More Features, More Stable Human-Agent Relations",
        paragraphs: [
          "Many products describe differentiation as feature lists. In production, real differentiation is often encoded in human-agent relations. Downcity prioritizes three fundamentals: human control is not diluted, engineering paths are not forcibly rewritten, and teams can keep iterating without hard dependency on a platform operator.",
          "These priorities may look less flashy, but they decide whether a system can enter daily operation. In production, the biggest risk is not insufficient capability; it is relationship imbalance.",
          "That is why “auditable” and “replayable” are treated as baseline capabilities rather than the core narrative. The deeper question is whether humans and agents can sustain a long-term collaboration model that compounds gains instead of governance cost.",
        ],
      },
    ],
  },
} as const;

export function WhitepaperSection() {
  // 语言必须来自 URL：i18next 单例在服务端固定为 en，用 i18n.language 会把 /zh/ 预渲染成英文正文。
  const locale = use_interface_locale();
  const [copied, setCopied] = useState(false);
  const [whitepaperCopied, setWhitepaperCopied] = useState(false);
  const [whitepaperCopyFailed, setWhitepaperCopyFailed] = useState(false);
  const isZh = locale === "zh";
  const content = isZh ? WHITEPAPER.zh : WHITEPAPER.en;

  const renderParagraph = (paragraph: string) =>
    paragraph
      .split(/(\*\*[^*]+\*\*)/g)
      .filter((segment) => segment.length > 0)
      .map((segment, index) =>
        segment.startsWith("**") && segment.endsWith("**") ? (
          <strong key={`${segment}-${index}`} className="font-semibold text-foreground">
            {segment.slice(2, -2)}
          </strong>
        ) : (
          <span key={`${segment}-${index}`}>{segment}</span>
        ),
      );

  const onCopyInstall = () => {
    navigator.clipboard.writeText(INSTALL_COMMAND);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const onCopyWhitepaper = async () => {
    try {
      const response = await fetch(WHITEPAPER_DOWNLOAD_PATH);
      if (!response.ok) {
        throw new Error("Failed to fetch whitepaper markdown");
      }

      const markdown = await response.text();
      await navigator.clipboard.writeText(markdown);
      setWhitepaperCopied(true);
      setWhitepaperCopyFailed(false);
      window.setTimeout(() => setWhitepaperCopied(false), 1500);
    } catch {
      setWhitepaperCopyFailed(true);
      window.setTimeout(() => setWhitepaperCopyFailed(false), 1800);
    }
  };

  const copyPaperText = whitepaperCopied
    ? content.copyPaperSuccess
    : whitepaperCopyFailed
      ? content.copyPaperFail
      : content.copyPaperLabel;

  return (
    <section className="mx-auto max-w-3xl px-5 py-16 md:px-8 md:py-24 lg:px-20">
      <article className="space-y-12 md:space-y-16">
        <header className="grid gap-6 lg:grid-cols-[1fr_0.9fr] lg:items-end">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-text-soft">
              {content.badge}
            </span>
            <h1 className="font-serif text-[clamp(1.875rem,4vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
              {content.title}
            </h1>
            <p className="font-serif text-base leading-8 text-text-soft md:text-lg">{content.epigraph}</p>
          </div>
          <div className="space-y-4 rounded-[14px] border border-line bg-card p-5 shadow-sm md:p-6">
            <div>
              <p className="text-[0.78rem] font-medium uppercase tracking-[0.04em] text-text-soft">{content.railTitle}</p>
              <p className="mt-2 text-sm leading-relaxed text-text-soft">{content.railBody}</p>
            </div>
            <div className="grid gap-3 rounded-xl border border-line bg-surface-soft p-4">
              <div>
                <p className="text-[0.78rem] font-medium uppercase tracking-[0.04em] text-text-soft">{content.commandLabel}</p>
                <code className="mt-2 block overflow-x-auto font-mono text-[0.82rem] leading-6 text-foreground">
                  {INSTALL_COMMAND}
                </code>
              </div>
              <button
                type="button"
                onClick={onCopyInstall}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-foreground/[0.05] px-5 text-sm font-semibold text-foreground transition-colors hover:bg-foreground/[0.08]"
              >
                {copied ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
                {copied ? (isZh ? "已复制" : "Copied") : (isZh ? "复制命令" : "Copy Command")}
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href={WHITEPAPER_DOWNLOAD_PATH}
                download={WHITEPAPER_DOWNLOAD_FILENAME}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-76"
              >
                <IconDownload className="size-4" />
                {content.downloadLabel}
              </a>
              <button
                type="button"
                onClick={onCopyWhitepaper}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-foreground/[0.05] px-5 text-sm font-semibold text-foreground transition-colors hover:bg-foreground/[0.08]"
              >
                <IconCopy className="size-4" />
                {copyPaperText}
              </button>
            </div>
          </div>
        </header>

        <section className="space-y-10 md:space-y-12">
          {content.sections.map((section, index) => (
            <section
              key={section.title}
              className={cn("grid gap-4", index !== 0 && "border-t border-line pt-10 md:pt-12")}
            >
              <div className="space-y-3">
                <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.06em] text-text-subtle">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h2 className="font-serif text-[clamp(1.5rem,3vw,1.875rem)] font-bold leading-[1.16] tracking-[-0.02em] text-foreground">
                  {section.title}
                </h2>
              </div>
              <div className="space-y-5 text-base leading-[1.75] text-text-soft">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{renderParagraph(paragraph)}</p>
                ))}
              </div>
            </section>
          ))}
        </section>
      </article>
    </section>
  );
}

export default WhitepaperSection;
