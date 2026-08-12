import { loader } from "fumadocs-core/source";
import { citySdkDocs } from "../../.source/server";
import { i18n } from "./i18n";

/**
 * City SDK 文档 source 装载模块。
 * 说明：
 * 1. `city-sdk-docs` 承载 Federation SDK 与 Agent Host City 的公开文档。
 * 2. 具体 payments 能力迁移到 `payments`，这里只保留 Federation 与宿主边界。
 */
export const citySdkDocsSource = loader({
  baseUrl: "/city-sdk-docs",
  source: citySdkDocs.toFumadocsSource(),
  i18n,
});
