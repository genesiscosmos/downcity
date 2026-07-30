/**
 * 首页 Schema.org JSON-LD 输出组件。
 *
 * 组件根据当前中英文首页生成同一组稳定实体，只让用户可见说明跟随页面语言变化。
 */
import { useLocation } from "react-router";
import { get_path_locale } from "@/lib/seo";
import {
  create_home_structured_data,
  serialize_structured_data,
} from "@/lib/structured-data";

/** 在首页 HTML 中输出可供搜索引擎直接读取的实体图。 */
export function HomeStructuredData() {
  const location = useLocation();
  const structured_data = create_home_structured_data(
    get_path_locale(location.pathname) === "zh",
  );

  return (
    <script
      type="application/ld+json"
      data-downcity-structured-data="home"
      dangerouslySetInnerHTML={{
        __html: serialize_structured_data(structured_data),
      }}
    />
  );
}
