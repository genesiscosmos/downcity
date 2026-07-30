/**
 * Downcity 首页结构化数据模块。
 *
 * 该模块只负责声明品牌实体和实体关系，不负责页面渲染。所有实体使用稳定 @id，
 * 让搜索引擎能够把 Genesis Cosmos、Downcity 官网和 Downcity 软件识别为同一产品体系。
 */
import { create_site_url } from "@/lib/seo";
import { homepage_positioning } from "@/lib/homepage-positioning";
import type { SeoHomeStructuredData } from "@/types/seo";

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
        applicationSubCategory: "Agentic Product Environment",
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
 * 把 JSON-LD 转换成可安全嵌入 HTML script 的文本。
 */
export function serialize_structured_data(data: SeoHomeStructuredData): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
