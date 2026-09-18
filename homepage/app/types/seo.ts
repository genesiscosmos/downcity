/**
 * Homepage SEO 类型定义。
 *
 * 该模块集中描述 canonical、hreflang 与 sitemap 所需的数据结构，避免路由模块
 * 各自拼接站点 URL 后产生域名、尾斜杠和语言路径不一致。
 */

/** 页面级 SEO 元信息生成参数。 */
export type SeoPageMetaOptions = {
  /** 浏览器标题以及 Open Graph、Twitter 使用的页面标题。 */
  title: string;
  /** 搜索结果摘要以及社交分享使用的页面说明。 */
  description: string;
  /** 当前页面的公开路径，不包含域名、查询参数和哈希。 */
  pathname: string;
  /** 当前页面自然覆盖的关键词；未提供时不输出 keywords 标签。 */
  keywords?: string;
  /** Open Graph 内容类型，营销页默认使用 website。 */
  open_graph_type?: "website" | "article";
  /** Twitter 卡片类型，默认使用 summary。 */
  twitter_card?: "summary" | "summary_large_image";
  /** 社交分享图片路径，默认使用全站 social-icon.png。 */
  image_pathname?: string;
  /** 页面是否存在英文与中文两个等价版本。 */
  localized?: boolean;
  /** 当前页面另一语言版本的公开路径；文档页应传入真实存在的对应页面。 */
  alternate_pathname?: string;
};

/** sitemap 中单个规范页面及其语言版本。 */
export type SeoSitemapEntry = {
  /** 当前 sitemap 条目的规范公开路径。 */
  pathname: string;
  /** 同一内容的英文页面路径；不存在时不输出英文 hreflang。 */
  english_pathname?: string;
  /** 同一内容的中文页面路径；不存在时不输出中文 hreflang。 */
  chinese_pathname?: string;
};

/** JSON-LD 中对另一个稳定实体的引用。 */
export type SeoStructuredDataReference = {
  /** 被引用实体的全局稳定标识。 */
  "@id": string;
};

/** Downcity 发布方的 Organization 结构化数据。 */
export type SeoOrganizationStructuredData = {
  /** Schema.org 实体类型。 */
  "@type": "Organization";
  /** 发布方实体的全局稳定标识。 */
  "@id": string;
  /** 发布方公开名称。 */
  name: string;
  /** 发布方规范官网地址。 */
  url: string;
};

/** Downcity 官网的 WebSite 结构化数据。 */
export type SeoWebsiteStructuredData = {
  /** Schema.org 实体类型。 */
  "@type": "WebSite";
  /** 网站实体的全局稳定标识。 */
  "@id": string;
  /** 网站公开品牌名称。 */
  name: string;
  /** 帮助搜索引擎消歧的品牌备用名称。 */
  alternateName: string;
  /** 网站规范首页地址。 */
  url: string;
  /** 网站支持的内容语言。 */
  inLanguage: readonly string[];
  /** 网站发布方实体引用。 */
  publisher: SeoStructuredDataReference;
  /** 网站主要描述的软件实体引用。 */
  about: SeoStructuredDataReference;
};

/** Downcity 产品的 SoftwareApplication 结构化数据。 */
export type SeoSoftwareApplicationStructuredData = {
  /** Schema.org 实体类型。 */
  "@type": "SoftwareApplication";
  /** 软件实体的全局稳定标识。 */
  "@id": string;
  /** 软件公开品牌名称。 */
  name: string;
  /** 帮助搜索引擎消歧的产品备用名称。 */
  alternateName: string;
  /** 软件对外产品说明。 */
  description: string;
  /** 软件规范产品地址。 */
  url: string;
  /** 软件图标的公开绝对地址。 */
  image: string;
  /** Schema.org 约定的应用大类。 */
  applicationCategory: "DeveloperApplication";
  /** 更准确描述产品职责的应用子类。 */
  applicationSubCategory: string;
  /** 软件支持的操作系统。 */
  operatingSystem: string;
  /** 软件是否可以免费获得和使用。 */
  isAccessibleForFree: true;
  /** 软件公开许可证地址。 */
  license: string;
  /** 软件主代码仓库地址。 */
  codeRepository: string;
  /** 软件创建方实体引用。 */
  creator: SeoStructuredDataReference;
  /** 软件发布方实体引用。 */
  publisher: SeoStructuredDataReference;
  /** 与当前软件实体等价或直接相关的权威页面。 */
  sameAs: readonly string[];
};

/** 首页输出的完整 Schema.org JSON-LD 图。 */
export type SeoHomeStructuredData = {
  /** JSON-LD 使用的 Schema.org 上下文。 */
  "@context": "https://schema.org";
  /** 通过稳定 @id 相互关联的发布方、网站和软件实体。 */
  "@graph": readonly [
    SeoOrganizationStructuredData,
    SeoWebsiteStructuredData,
    SeoSoftwareApplicationStructuredData,
  ];
};

/** FAQ 页输出的单个问答实体。 */
export type SeoFAQQuestionStructuredData = {
  /** Schema.org 问题实体类型。 */
  "@type": "Question";
  /** 用户可见的问题全文。 */
  name: string;
  /** 与页面可见内容一致的采纳答案。 */
  acceptedAnswer: {
    /** Schema.org 答案实体类型。 */
    "@type": "Answer";
    /** 答案全文，必须与页面实际渲染内容一致。 */
    text: string;
  };
};

/** FAQ 页输出的完整 FAQPage JSON-LD。 */
export type SeoFAQStructuredData = {
  /** JSON-LD 使用的 Schema.org 上下文。 */
  "@context": "https://schema.org";
  /** 声明当前页面为 FAQ 问答页。 */
  "@type": "FAQPage";
  /** 页面包含的全部问答。 */
  mainEntity: readonly SeoFAQQuestionStructuredData[];
};

/** 文档页面包屑中的单个层级。 */
export type SeoBreadcrumbItemStructuredData = {
  /** 层级序号，从 1 开始。 */
  position: number;
  /** 层级显示名称，与页面可见导航一致。 */
  name: string;
  /** 层级对应的公开 URL。 */
  item: string;
};

/** 文档页输出的完整 BreadcrumbList JSON-LD。 */
export type SeoBreadcrumbStructuredData = {
  /** JSON-LD 使用的 Schema.org 上下文。 */
  "@context": "https://schema.org";
  /** 声明当前页面为面包屑列表。 */
  "@type": "BreadcrumbList";
  /** 从文档根到当前页的有序层级。 */
  itemListElement: readonly SeoBreadcrumbItemStructuredData[];
};

/** 文章页输出的 BlogPosting JSON-LD。 */
export type SeoArticleStructuredData = {
  /** JSON-LD 使用的 Schema.org 上下文。 */
  "@context": "https://schema.org";
  /** 声明当前页面为一篇文章。 */
  "@type": "BlogPosting";
  /** 文章标题，与页面 h1 保持一致。 */
  headline: string;
  /** 文章摘要，与页面 description 保持一致。 */
  description: string;
  /** 文章首次发布日期（ISO 8601 日期）。 */
  datePublished: string;
  /** 文章正文语言。 */
  inLanguage: string;
  /** 指向承载本文的页面实体。 */
  mainEntityOfPage: {
    /** Schema.org 网页实体类型。 */
    "@type": "WebPage";
    /** 本文的规范公开地址。 */
    "@id": string;
  };
  /** 文章作者实体引用。 */
  author: SeoStructuredDataReference;
  /** 文章发布方实体引用。 */
  publisher: SeoStructuredDataReference;
  /** 本文主要讨论的软件实体引用，用于与首页实体图建立关联。 */
  about: SeoStructuredDataReference;
  /** 本文所属站点实体引用。 */
  isPartOf: SeoStructuredDataReference;
};
