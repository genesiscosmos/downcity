import i18n from "i18next";
import { initReactI18next, I18nextProvider } from "react-i18next";

// Import translation files
//
// 只保留实际被引用的 namespace。此前 13 个 namespace 全量载入，其中 8 个
// （ecosystem / hero / models / platforms / stats / steps / tutorial / usecases）
// 在 app 代码中没有任何 `t("ns:...")` 或 useTranslation("ns") 引用，
// 却随 root chunk 发往全部 500+ 页面。移除后单次传输约省 6 KB（brotli）。
import enCommon from "./en/common.json";
import zhCommon from "./zh/common.json";
import enFeatures from "./en/features.json";
import zhFeatures from "./zh/features.json";
import enResources from "./en/resources.json";
import zhResources from "./zh/resources.json";
import enCommunity from "./en/community.json";
import zhCommunity from "./zh/community.json";
import enHome from "./en/home.json";
import zhHome from "./zh/home.json";

// Resources configuration
const resources = {
  en: {
    common: enCommon,
    features: enFeatures,
    resources: enResources,
    community: enCommunity,
    home: enHome,
  },
  zh: {
    common: zhCommon,
    features: zhFeatures,
    resources: zhResources,
    community: zhCommunity,
    home: zhHome,
  },
} as const;

// Initialize i18n synchronously for SSR
// Note: Language will be set based on URL path in root.tsx to ensure server/client consistency
i18n.use(initReactI18next).init({
  resources,
  lng: "en", // Default language, will be overridden by URL path
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common", "features", "resources", "community", "home"],
  interpolation: {
    escapeValue: false, // React already escapes values
  },
  react: {
    useSuspense: false,
  },
});

export { I18nextProvider };
export default i18n;
