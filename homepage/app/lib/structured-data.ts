/**
 * Downcity 首页结构化数据模块。
 *
 * 该模块只负责声明品牌实体和实体关系，不负责页面渲染。所有实体使用稳定 @id，
 * 让搜索引擎能够把 Genesis Cosmos、Downcity 官网和 Downcity 软件识别为同一产品体系。
 */
import { create_site_url } from "@/lib/seo";
import { homepage_positioning } from "@/lib/homepage-positioning";
import type {
  SeoArticleStructuredData,
  SeoBreadcrumbStructuredData,
  SeoFAQStructuredData,
  SeoHomeStructuredData,
} from "@/types/seo";

const organization_id = "https://genesiscosmos.com/#organization";
const website_id = `${create_site_url("/")}#website`;
const software_id = `${create_site_url("/")}#software`;
const github_url = "https://github.com/genesiscosmos/downcity";
const twitter_url = "https://x.com/downcity_ai";
const genesis_product_url = "https://genesiscosmos.com/products/downcity/";

/**
 * 创建首页使用的 Schema.org 实体图。
 *
 * 页面语言只影响用户可见的软件说明；实体标识和关系在中英文首页保持一致。
 */
export function create_home_structured_data(is_chinese: boolean): SeoHomeStructuredData {
  const positioning = homepage_positioning[is_chinese ? "zh" : "en"];

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organization_id,
        name: "Genesis Cosmos",
        url: "https://genesiscosmos.com/",
      },
      {
        "@type": "WebSite",
        "@id": website_id,
        name: "Downcity",
        alternateName: "Downcity AI",
        url: create_site_url("/"),
        inLanguage: ["en", "zh-CN"],
        publisher: { "@id": organization_id },
        about: { "@id": software_id },
      },
      {
        "@type": "SoftwareApplication",
        "@id": software_id,
        name: "Downcity",
        alternateName: "Downcity AI",
        description: positioning.meta_description,
        url: create_site_url("/product/"),
        image: create_site_url("/icon-512.png"),
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "Agent Harness and Productization Kits",
        operatingSystem: "macOS, Linux, Windows",
        isAccessibleForFree: true,
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        codeRepository: github_url,
        creator: { "@id": organization_id },
        publisher: { "@id": organization_id },
        sameAs: [genesis_product_url, github_url, twitter_url],
      },
    ],
  };
}

/**
 * 创建 FAQ 页使用的 FAQPage JSON-LD。
 *
 * 问答内容必须与页面实际渲染的可见文本一致，否则不符合搜索引擎的富结果规范。
 */
export function create_faq_structured_data(
  items: ReadonlyArray<{ question: string; answer: string }>,
): SeoFAQStructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

/**
 * 创建文档页使用的 BreadcrumbList JSON-LD。
 *
 * 层级必须从文档根开始按顺序排列，最后一层对应当前页面自身。
 */
export function create_breadcrumb_structured_data(
  items: ReadonlyArray<{ name: string; pathname: string }>,
): SeoBreadcrumbStructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      position: index + 1,
      name: item.name,
      item: create_site_url(item.pathname),
    })),
  };
}

/**
 * 创建文章页使用的 BlogPosting JSON-LD。
 *
 * 关键点：author、publisher 复用首页实体图中的 Organization，about 指向 Downcity
 * 软件实体。这样文章与首页实体图共享同一组 @id，搜索引擎能把它识别为同一产品体系
 * 的内容，而不是一个孤立的页面。
 */
export function create_article_structured_data(options: {
  title: string;
  description: string;
  pathname: string;
  date_published: string;
  lang: "en" | "zh";
}): SeoArticleStructuredData {
  const canonical_url = create_site_url(options.pathname);

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: options.title,
    description: options.description,
    datePublished: options.date_published,
    inLanguage: options.lang === "zh" ? "zh-CN" : "en",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonical_url,
    },
    author: { "@id": organization_id },
    publisher: { "@id": organization_id },
    about: { "@id": software_id },
    isPartOf: { "@id": website_id },
  };
}

/**
 * 把 JSON-LD 转换成可安全嵌入 HTML script 的文本。
 */
export function serialize_structured_data(
  data:
    | SeoHomeStructuredData
    | SeoFAQStructuredData
    | SeoBreadcrumbStructuredData
    | SeoArticleStructuredData,
): string {
  // 源码字面量 \\u003c 在运行时是单反斜杠 + u003c：JSON.parse 会还原为 <，
  // 同时避免原始 </script> 出现在 HTML 内联脚本中导致提前闭合。
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
