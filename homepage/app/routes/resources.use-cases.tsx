import { useTranslation } from "react-i18next";
import { COMMUNITY_LINKS } from "@/lib/community-links";
import { product } from "@/lib/product";
import { marketingTheme } from "@/lib/marketing-theme";

export function meta() {
  const title = `${product.productName} — Use Cases`;
  const description = "Real-world applications and scenarios for Downcity";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
  ];
}

const useCases = [
  {
    id: "collaborator",
    bulletKeys: ["review", "answer", "onboard", "bugs", "docs"],
    example: `# Create/init the Agent project\ncity agent create .\n\n# Start the single City host\ncity on\n\n# In Telegram, chat with your Agent:\n/status          # Check project status\nSuggest refactor auth  # Suggest how to refactor auth module\nRun tests              # Run tests`,
  },
  {
    id: "worker",
    bulletKeys: ["todo", "deps", "reports", "quality", "tests"],
    example: `# In .downcity/tasks/daily-todo-scan.md:\n---\nid: daily-todo-scan\ncron: "0 9 * * *"\nnotify: telegram\n---\n\nScan the repository for TODO comments.\nSummarize them by file.\nSuggest which ones should be prioritized.`,
  },
  {
    id: "interface",
    bulletKeys: ["deploy", "query", "infra", "workflows", "logs"],
    example: `# Telegram Bot = Your Project UI\n\n/status              # Check status\n/clear               # Clear conversation history\n<any message>        # Execute instruction\n\n# Hard clean one broken chat session\ndowncity agent history clean . \\\n  --channel telegram \\\n  --chat-id <chat-id> \\\n  --hard`,
  },
  {
    id: "maintainer",
    bulletKeys: ["depUpdates", "security", "quality", "perf", "coverage"],
    example: `# Agent automatically:\n1. Scans for security issues\n2. Proposes fixes via pull requests\n3. Implements changes (tool-driven)\n4. Documents all actions`,
  },
] as const;

export default function UseCases() {
  const { t } = useTranslation();
  const discussionsUrl = COMMUNITY_LINKS.telegram;

  return (
    <div className={marketingTheme.pageNarrow}>
      <header className="space-y-3">
        <span className={marketingTheme.badge}>
          Use Cases
        </span>
        <h1 className={marketingTheme.pageTitle}>{t("nav.useCases")}</h1>
        <p className={marketingTheme.lead}>
          {t("resources:useCasesPage.subtitle")}
        </p>
      </header>

      <div className="mt-8 space-y-5">
        {useCases.map((useCase, index) => (
          <section key={useCase.id} className={`${marketingTheme.panel} p-5 md:p-6`}>
            <div className="grid gap-5 md:grid-cols-[1.05fr_0.95fr] md:items-start">
              <div>
                <p className={marketingTheme.eyebrow}>
                  Scenario {String(index + 1).padStart(2, "0")}
                </p>
                <h2 className="mt-2 font-serif text-[1.5rem] font-semibold tracking-[-0.03em] text-foreground">
                  {t(`resources:useCasesPage.cases.${useCase.id}.title`)}
                </h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  {t(`resources:useCasesPage.cases.${useCase.id}.description`)}
                </p>
                <ul className="mt-3 space-y-2">
                  {useCase.bulletKeys.map((bulletKey) => (
                    <li key={bulletKey} className="flex items-start gap-2 text-sm leading-7 text-muted-foreground">
                      <span className="mt-2 inline-flex size-1.5 rounded-full bg-foreground/50" />
                      {t(`resources:useCasesPage.cases.${useCase.id}.bullets.${bulletKey}`)}
                    </li>
                  ))}
                </ul>
              </div>

              <div className={`${marketingTheme.panelSoft} px-3 py-3`}>
                <p className={marketingTheme.eyebrow}>
                  {t("resources:useCasesPage.exampleLabel")}
                </p>
                <pre className="mt-2 overflow-x-auto">
                  <code className="font-mono text-[0.78rem] leading-6 text-foreground">{useCase.example}</code>
                </pre>
              </div>
            </div>
          </section>
        ))}
      </div>

      <section className={`${marketingTheme.panel} mt-8 p-6`}>
        <h3 className="text-lg font-semibold">{t("resources:useCasesPage.callout.title")}</h3>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          {t("resources:useCasesPage.callout.description")}
        </p>
        <a
          href={discussionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-4 ${marketingTheme.primaryButton}`}
        >
          {t("resources:useCasesPage.callout.button")}
        </a>
      </section>
    </div>
  );
}
