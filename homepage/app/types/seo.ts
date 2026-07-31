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
