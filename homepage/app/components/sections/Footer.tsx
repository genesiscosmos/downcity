import type { FC } from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { homepage_positioning } from "@/lib/homepage-positioning";
import { resolve_interface_locale } from "@/lib/interface-locale";
import { product } from "@/lib/product";

const GITHUB_URL = "https://github.com/genesiscosmos/downcity";
const TWITTER_URL = "https://x.com/downcity_ai";

/**
 * 全站页脚模块（多列完整版）。
 * 说明：
 * 1. 左侧品牌、tagline 与版权。
 * 2. 右侧多列导航：Product / Docs / Resources / Community。
 * 3. 底部社交链接与法律链接。
 */
export const Footer: FC = () => {
  const { i18n } = useTranslation("home");
  const location = useLocation();
  const currentYear = new Date().getFullYear();
  const locale = resolve_interface_locale(location.pathname, i18n.resolvedLanguage ?? i18n.language);
  const t = i18n.getFixedT(locale, "home");
  const isZh = locale === "zh";
  const positioning = homepage_positioning[locale];

  const homePath = isZh ? "/zh" : "/";
  const productPath = isZh ? "/zh/product" : "/product";
  const productSdkPath = isZh ? "/zh/product/sdk" : "/product/sdk";
  const productAgentSdkPath = isZh ? "/zh/product/agent-sdk" : "/product/agent-sdk";
  const productUiSdkPath = isZh ? "/zh/product/ui-sdk" : "/product/ui-sdk";
  const startPath = isZh ? "/zh/start" : "/start";
  const featuresPath = isZh ? "/zh/features" : "/features";
  const docsPath = isZh ? "/zh/docs" : "/en/docs";
  const citySdkDocsPath = isZh ? "/zh/city-sdk-docs" : "/en/city-sdk-docs";
  const agentSdkDocsPath = isZh ? "/zh/agent-sdk-docs" : "/en/agent-sdk-docs";
  const pluginsDocsPath = isZh ? "/zh/plugins-docs" : "/en/plugins-docs";
  const uiSdkDocsPath = isZh ? "/zh/ui-sdk-docs" : "/en/ui-sdk-docs";
  const paymentsPath = isZh ? "/zh/payments" : "/en/payments";
  const resourcesPath = isZh ? "/zh/resources" : "/resources";
  const skillsPath = isZh ? "/zh/resources/skills" : "/resources/skills";
  const marketplacePath = isZh ? "/zh/resources/marketplace" : "/resources/marketplace";
  const hostingPath = isZh ? "/zh/resources/hosting" : "/resources/hosting";
  const examplesPath = isZh ? "/zh/resources/examples" : "/resources/examples";
  const communityPath = isZh ? "/zh/community" : "/community";
  const faqPath = isZh ? "/zh/community/faq" : "/community/faq";
  const roadmapPath = isZh ? "/zh/community/roadmap" : "/community/roadmap";
  const termsPath = "/terms";
  const privacyPath = "/privacy";

  const columns = [
    {
      title: t("footer.columns.product"),
      links: [
        { label: t("footer.links.overview"), path: productPath },
        { label: isZh ? "快速开始" : "Quick Start", path: startPath },
        { label: "Agent SDK", path: productAgentSdkPath },
        { label: "City SDK", path: productSdkPath },
        { label: "UI SDK", path: productUiSdkPath },
        { label: t("footer.links.features"), path: featuresPath },
      ],
    },
    {
      title: t("footer.columns.docs"),
      links: [
        { label: t("footer.links.docs"), path: docsPath },
        { label: t("footer.links.agentDocs"), path: agentSdkDocsPath },
        { label: t("footer.links.cityDocs"), path: citySdkDocsPath },
        { label: t("footer.links.plugins"), path: pluginsDocsPath },
        { label: t("footer.links.payments"), path: paymentsPath },
      ],
    },
    {
      title: t("footer.columns.resources"),
      links: [
        { label: t("footer.links.skills"), path: skillsPath },
        { label: t("footer.links.marketplace"), path: marketplacePath },
        { label: t("footer.links.hosting"), path: hostingPath },
        { label: t("footer.links.examples"), path: examplesPath },
      ],
    },
    {
      title: t("footer.columns.community"),
      links: [
        { label: t("footer.links.faq"), path: faqPath },
        { label: t("footer.links.roadmap"), path: roadmapPath },
        { label: "GitHub", href: GITHUB_URL, external: true },
        { label: "X", href: TWITTER_URL, external: true },
      ],
    },
  ] as const;

  return (
    <footer className="border-t border-line bg-background">
      <div className="mx-auto max-w-[1600px] px-5 py-16 md:px-8 lg:px-20 lg:py-24">
        <div className="grid gap-12 lg:grid-cols-[1fr_2fr]">
          {/* Brand column */}
          <div className="space-y-5">
            <Link to={homePath} className="inline-flex items-center gap-2.5">
              <img src="/icon.svg" alt="Downcity" className="brand-logo block h-6 w-6 object-contain" />
              <span className="text-[0.9375rem] font-semibold text-foreground">{product.productName}</span>
            </Link>
            <p className="max-w-sm text-sm leading-relaxed text-text-soft">
              {positioning.footer_tagline}
            </p>
            <p className="text-xs text-text-subtle">
              {t("footer.copyright", { year: currentYear })}
            </p>
            <p className="text-xs text-text-subtle">
              <a
                href="https://genesiscosmos.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-soft transition-colors hover:text-foreground hover:underline"
              >
                {t("footer.poweredBy", { name: "GenesisCosmos" })}
              </a>
            </p>
          </div>

          {/* Links columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {columns.map((column) => (
              <div key={column.title} className="space-y-3">
                <h4 className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-text-subtle">
                  {column.title}
                </h4>
                <ul className="space-y-2">
                  {column.links.map((link) =>
                    "path" in link ? (
                      <li key={link.label}>
                        <Link
                          to={link.path}
                          className="text-sm text-text-soft transition-colors hover:text-foreground"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ) : (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-text-soft transition-colors hover:text-foreground"
                        >
                          {link.label}
                        </a>
                      </li>
                    )
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-line pt-8 sm:flex-row sm:items-center">
          <div className="flex items-center gap-6">
            <a
              href={TWITTER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-text-soft transition-colors hover:text-foreground"
            >
              X
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-text-soft transition-colors hover:text-foreground"
            >
              GitHub
            </a>
          </div>
          <div className="flex items-center gap-6">
            <Link to={termsPath} className="text-sm text-text-soft transition-colors hover:text-foreground">
              {t("footer.legal.terms")}
            </Link>
            <Link to={privacyPath} className="text-sm text-text-soft transition-colors hover:text-foreground">
              {t("footer.legal.privacy")}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
