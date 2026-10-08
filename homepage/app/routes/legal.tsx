import { Footer } from "@/components/sections/Footer";
import { product } from "@/lib/product";
import { create_page_meta } from "@/lib/seo";

/**
 * Legal 页面内容模型。
 * 说明：
 * 1. Legal 页面是用户可见的政策正文，需要保持结构稳定，便于后续审阅与更新。
 * 2. 字段文档写清楚展示语义，避免内容与样式耦合。
 */
type LegalPageContent = {
  /** 页面路径，用于 canonical、Open Graph URL 和内部路由识别。 */
  path: "/terms" | "/privacy";
  /** 浏览器标题与页面主标题。 */
  title: string;
  /** SEO 描述与页面导语。 */
  description: string;
  /** 页面顶部用于标识文档类型的短标签。 */
  eyebrow: string;
  /** 政策生效日期，直接展示给用户。 */
  effective_date: string;
  /** 正文段落分组。 */
  sections: LegalSection[];
};

/**
 * Legal 页面正文分组。
 */
type LegalSection = {
  /** 分组标题。 */
  title: string;
  /** 分组下的正文段落。 */
  paragraphs: string[];
};

const company_name = "genesis cosmos";
const contact_email = "support@genesiscosmos.com";

const legal_pages = {
  terms: {
    path: "/terms",
    title: "Terms of Service",
    description:
      "The terms that govern access to and use of Downcity AI-powered websites, software, services, documentation, credit purchases, and related materials.",
    eyebrow: "Legal",
    effective_date: "June 12, 2026",
    sections: [
      {
        title: "1. Introduction and acceptance of terms",
        paragraphs: [
          `Welcome to Downcity, a service provided by ${company_name} ("Downcity", "we", "us", or "our"). These Terms of Service govern your access to and use of our AI-powered services, including agent infrastructure, developer tools, hosted service features, documentation, credit purchases, and related materials available at https://downcity.ai (the "Service").`,
          "By creating an account, purchasing credits, connecting services, or otherwise using the Service, you confirm that you are at least 18 years old, have read and understood these Terms, agree to be bound by these Terms, agree to our Privacy Policy, and are authorized to accept these Terms on behalf of any organization you represent.",
          "If you do not agree to these Terms, you may not use the Service.",
        ],
      },
      {
        title: "2. Service description",
        paragraphs: [
          "Downcity provides an AI-powered platform and software stack that helps builders run agents, models, tools, tasks, memory, plugins, services, permissions, usage, billing, and control surfaces on reusable runtime infrastructure.",
          "The Service is a digital software product delivered through websites, software packages, hosted interfaces, APIs, documentation, and connected integrations. When access, credits, or digital functionality are delivered after confirmed payment, delivery is immediate and intangible.",
          "Downcity may connect to third-party AI model providers, infrastructure providers, payment processors, messaging systems, browser extensions, repositories, and other integrations you enable. Service performance and availability may be affected by those third-party providers.",
        ],
      },
      {
        title: "3. Account registration and eligibility",
        paragraphs: [
          "To use parts of the Service, you may need to create an account or connect a workspace with accurate and complete information. You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account.",
          `You must keep your billing email and account information up to date, protect API keys, tokens, secrets, and devices used with Downcity, and notify us immediately of any unauthorized use at ${contact_email}.`,
          "You are responsible for how you configure, deploy, and operate Downcity, including the agents, powers, models, tools, credentials, data sources, approvals, and workflows you connect to it.",
        ],
      },
      {
        title: "4. Credits and top-up plans",
        paragraphs: [
          "The Service may operate on a credit-based or balance-based system. Credits or balances may be used to access eligible Service features, AI calls, hosted usage, or other metered functionality described at checkout or in the applicable product surface.",
          "Current credit packages, pricing, included features, and usage rules are shown on the relevant pricing, checkout, or product page. Prices and package terms may change for future purchases.",
          "Credits are digital, intangible access units. Credits have no cash value, are not a stored-value account, are not a bank deposit, are not transferable unless we expressly allow it, and may be used only inside the Service.",
        ],
      },
      {
        title: "5. Billing and payment",
        paragraphs: [
          "Each credit or top-up purchase is a one-time transaction. By completing a purchase, you authorize Downcity and our payment processor to charge your selected payment method for the amount displayed at checkout, including applicable taxes and fees.",
          "Payment card data is processed by our PCI-DSS certified payment processor, Waffo Pancake. Downcity does not directly store full payment card numbers.",
          "If automatic top-up is offered and you enable it, you authorize us to automatically charge your saved payment method when your credit balance falls below the threshold you configure. You may disable automatic top-up at any time in the product surface where it is offered.",
          "Prices are exclusive of applicable taxes unless otherwise stated. You are responsible for any taxes, duties, levies, or similar governmental assessments associated with your purchase.",
        ],
      },
      {
        title: "6. Credit validity and account termination",
        paragraphs: [
          "Unless a different validity period is stated at checkout, purchased credits remain valid for 12 months from the date of purchase. We may send reminders before expiry when supported by the Service.",
          "If your account is terminated or closed, unused credits may remain available for 30 days following termination unless your account was terminated for breach, fraud, abuse, legal risk, security risk, or unless applicable law requires a different result.",
          "After the applicable validity or retention period expires, unused credits expire without refund unless required by applicable law.",
        ],
      },
      {
        title: "7. Refund policy",
        paragraphs: [
          "Credit purchases are generally non-refundable after credits have been consumed because the Service is delivered immediately as a digital, intangible product.",
          "Unused credits may be eligible for a full refund within 7 days of purchase. Duplicate charges and confirmed billing errors are eligible for a refund. Statutory rights, including any applicable withdrawal rights, are preserved where required by law.",
          "Used credits, expired credits, promotional credits, credits granted without payment, and accounts terminated for violation of these Terms or the Acceptable Use Policy are not refundable unless required by applicable law.",
          `To request a refund, contact ${contact_email} with your account email, transaction ID, and reason. We aim to acknowledge refund requests within 2 business days and process eligible refunds within 5 to 10 business days.`,
        ],
      },
      {
        title: "8. Billing disputes",
        paragraphs: [
          `If you believe there is an error in a charge, please contact ${contact_email} before disputing the charge with your bank or card issuer. We aim to respond within 2 business days and resolve confirmed billing errors within 5 business days.`,
          "Providing prompt transaction details helps us investigate and may prevent unnecessary chargebacks or service interruptions.",
        ],
      },
      {
        title: "9. AI output and intellectual property",
        paragraphs: [
          "Subject to these Terms, AI-generated content produced in response to your inputs is owned by you to the extent permitted by applicable law and the rules of any model provider or third-party service involved.",
          "By submitting content, prompts, files, repository context, tool results, messages, or other inputs to the Service, you grant Downcity a limited, non-exclusive license to process those inputs solely to provide, secure, troubleshoot, and improve the Service.",
          "We do not use your inputs to train AI models without your explicit consent. Third-party AI model providers may process inputs and outputs according to their own terms and privacy policies when you enable or configure those providers.",
          "AI-generated content may contain errors, omissions, outdated information, or inaccurate statements. You are solely responsible for reviewing and verifying outputs before relying on them.",
        ],
      },
      {
        title: "10. Acceptable use policy",
        paragraphs: [
          "You agree not to use the Service to generate content that is illegal, defamatory, harassing, fraudulent, or otherwise harmful; generate, distribute, or facilitate deceptive deepfake content; generate content that sexualizes minors or violates child protection laws; produce malware, phishing content, exploit code, or cyberattack tooling; infringe intellectual property, privacy, publicity, or other rights; resell or sublicense access without written approval; or violate any applicable law, regulation, card network rule, or third-party service term.",
          "You may not use Service inputs, outputs, logs, or derivatives to train, fine-tune, benchmark, distill, or develop any AI or machine learning model that competes with the Service; systematically scrape or harvest model outputs at scale; or represent AI-generated outputs as the work of a licensed human professional.",
          "We may suspend, restrict, or terminate access if we reasonably believe use creates legal, security, operational, abuse, payment, or third-party platform risk.",
        ],
      },
      {
        title: "11. Data, privacy, and security",
        paragraphs: [
          "Your use of the Service is governed by our Privacy Policy at https://downcity.ai/privacy. You are responsible for ensuring you have the rights and permissions needed for any content, repositories, prompts, files, credentials, personal data, or third-party data you process with Downcity.",
          "Payment card data is processed by Waffo Pancake. Account and operational data may be retained as needed to provide the Service, comply with legal obligations, resolve disputes, enforce agreements, maintain security, and preserve auditability.",
          "We use reasonable administrative, technical, and organizational measures to protect information, but no system is perfectly secure. You are responsible for safeguarding your local environments, connected services, credentials, and approval flows.",
        ],
      },
      {
        title: "12. Disclaimers and limitation of liability",
        paragraphs: [
          'THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AVAILABILITY, SECURITY, OR ACCURACY OF AI OUTPUTS.',
          "AI outputs may be inaccurate, incomplete, or outdated. Do not rely on them for legal, medical, financial, safety-critical, or other professional advice. Always verify AI-generated content with a qualified professional before acting on it.",
          "TO THE MAXIMUM EXTENT PERMITTED BY LAW, GENESIS COSMOS, DOWNCITY, AND THEIR CONTRIBUTORS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUES, DATA, GOODWILL, OR BUSINESS OPPORTUNITIES. OUR TOTAL LIABILITY WILL NOT EXCEED THE AMOUNT YOU PAID TO DOWNCITY IN THE 12 MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM.",
        ],
      },
      {
        title: "13. Term and termination",
        paragraphs: [
          "We may suspend or terminate your account or access to the Service if you materially breach these Terms, we suspect fraudulent or abusive activity, your use creates risk for Downcity or others, or termination is required by law or a third-party provider.",
          "If we terminate access for reasons other than your breach, fraud, abuse, or legal risk, we may provide a pro-rated refund or credit for unused paid access where applicable and commercially reasonable.",
          `You may stop using the Service or request account deletion by contacting ${contact_email}. Some information may be retained as described in our Privacy Policy or as required for legal, security, billing, or audit purposes.`,
        ],
      },
      {
        title: "14. Governing law and informal resolution",
        paragraphs: [
          `These Terms are governed by the laws applicable to ${company_name}, without regard to conflict-of-law principles. If a specific jurisdiction is identified at checkout or in a signed agreement, that information controls for that transaction.`,
          `Before initiating formal proceedings, please contact ${contact_email} and give us a reasonable opportunity to resolve the dispute informally.`,
        ],
      },
      {
        title: "15. General provisions",
        paragraphs: [
          "Some Downcity software may be distributed under open source licenses. Those licenses govern the relevant open source code and may provide rights that are separate from these Terms. These Terms do not limit rights granted under an applicable open source license.",
          "We may update these Terms as Downcity evolves. Material changes will be notified by email, product notice, website notice, repository notice, or another appropriate channel at least 14 days before the effective date when reasonably practicable.",
          "Your continued use of the Service after updated Terms take effect means you accept the updated Terms. If any provision is unenforceable, the remaining provisions remain in effect.",
        ],
      },
      {
        title: "16. Contact information",
        paragraphs: [
          `General support, billing, refunds, cancellation, legal, privacy, and security questions can be sent to ${contact_email}.`,
          "By using the Service or checking \"I agree\" at checkout, you acknowledge and agree to these Terms.",
          `Last Updated: June 12, 2026 · ${company_name} · Downcity · https://downcity.ai`,
        ],
      },
    ],
  },
  privacy: {
    path: "/privacy",
    title: "Privacy Policy",
    description:
      "How Downcity handles information when you use our websites, software, services, documentation, and related materials.",
    eyebrow: "Privacy",
    effective_date: "June 12, 2026",
    sections: [
      {
        title: "Overview",
        paragraphs: [
          "This Privacy Policy explains how Downcity collects, uses, discloses, and protects information when you use our websites, software, services, documentation, and related materials.",
          "Downcity is designed for builders who connect agents to tools, repositories, models, services, and communication channels. Your own configuration choices determine much of the data that flows through your environment.",
        ],
      },
      {
        title: "Information we collect",
        paragraphs: [
          "We may collect account and contact information, usage information, device and log information, support communications, billing-related information, and information you choose to provide through forms, messages, repositories, prompts, files, or integrations.",
          "When Downcity connects to third-party services, we may process information needed to perform the requested integration, such as tokens, workspace identifiers, event payloads, messages, task metadata, and operational logs.",
        ],
      },
      {
        title: "How we use information",
        paragraphs: [
          "We use information to provide, operate, secure, troubleshoot, support, and improve Downcity; to communicate with users; to prevent abuse; to comply with legal obligations; and to develop new features.",
          "We may use aggregated or de-identified information to understand product usage and improve reliability, documentation, onboarding, and user experience.",
        ],
      },
      {
        title: "Model providers and integrations",
        paragraphs: [
          "Downcity may send prompts, files, tool results, messages, metadata, or other configured context to model providers and third-party integrations you enable. Those providers process information under their own terms and privacy policies.",
          "Review the settings, permissions, and data policies of each provider or integration before connecting it to Downcity.",
        ],
      },
      {
        title: "How we share information",
        paragraphs: [
          "We may share information with service providers who help us operate Downcity, with third-party integrations you authorize, when required by law, to protect rights and security, or as part of a business transaction such as a merger or acquisition.",
          "We do not sell personal information.",
        ],
      },
      {
        title: "Security and retention",
        paragraphs: [
          "We use reasonable administrative, technical, and organizational measures to protect information. No system is perfectly secure, and you are responsible for safeguarding credentials, secrets, local environments, and connected services.",
          "We retain information for as long as needed to provide services, comply with legal obligations, resolve disputes, enforce agreements, and maintain security and auditability.",
        ],
      },
      {
        title: "Your choices",
        paragraphs: [
          "You can choose what information to provide, which integrations to connect, which data sources agents can access, and when to revoke credentials or permissions.",
          `Depending on your location, you may have rights to access, correct, delete, or export certain personal information. You can contact us at ${contact_email} to make a request.`,
        ],
      },
      {
        title: "International use",
        paragraphs: [
          "Downcity may process information in countries other than where you live. These countries may have data protection laws that differ from those in your jurisdiction.",
        ],
      },
      {
        title: "Changes to this policy",
        paragraphs: [
          "We may update this Privacy Policy as Downcity evolves. If changes are material, we will use reasonable efforts to provide notice through the website, product surface, repository, or other appropriate channel.",
        ],
      },
      {
        title: "Contact",
        paragraphs: [
          `Questions or requests about privacy can be sent to ${contact_email}.`,
        ],
      },
    ],
  },
} satisfies Record<string, LegalPageContent>;

/**
 * 生成 Legal 页面的 SEO 元信息。
 */
export function create_legal_meta(page_key: keyof typeof legal_pages) {
  const page = legal_pages[page_key];
  const title = `${product.productName} — ${page.title}`;

  return create_page_meta({
    title,
    description: page.description,
    pathname: page.path,
  });
}

/**
 * 通用 Legal 页面组件（Vibecape 风格）。
 * 说明：
 * 1. 统一法律页容器，最大宽度约 768px。
 * 2. 使用细边框卡片包裹正文，标题层级清晰。
 */
export function LegalPage({ page_key }: { page_key: keyof typeof legal_pages }) {
  const page = legal_pages[page_key];

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-5 py-16 md:px-8 md:py-24">
        <article className="rounded-[14px] border border-line bg-card p-6 shadow-sm md:p-10">
          <header className="space-y-4 border-b border-line pb-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-text-soft">
              {page.eyebrow}
            </span>
            <div className="space-y-3">
              <h1 className="font-serif text-[clamp(1.875rem,4vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
                {page.title}
              </h1>
              <p className="text-base leading-[1.65] text-text-soft">{page.description}</p>
            </div>
            <p className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-text-soft">
              Effective date: {page.effective_date}
            </p>
          </header>

          <div className="space-y-10 py-10">
            {page.sections.map((section) => (
              <section key={section.title} className="space-y-4">
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
                  {section.title}
                </h2>
                <div className="space-y-4">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph} className="text-sm leading-relaxed text-text-soft">
                      {paragraph.includes(contact_email) ? (
                        <>
                          {paragraph.split(contact_email)[0]}
                          <a
                            href={`mailto:${contact_email}`}
                            className="font-medium text-foreground underline decoration-line-strong underline-offset-4 transition-opacity hover:opacity-70"
                          >
                            {contact_email}
                          </a>
                          {paragraph.split(contact_email).slice(1).join(contact_email)}
                        </>
                      ) : (
                        paragraph
                      )}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </article>
      </main>
      <Footer />
    </div>
  );
}
