/** 与 Duobox WelcomeMainView 完全相同结构的 Downcity 欢迎页。 */

import { TbBuildingCommunity } from "react-icons/tb";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import { use_translation } from "@/locales/i18n";

/** 中间主视图的空状态。 */
export function WelcomeView() {
  const translate = use_translation();
  return <MainViewLayout>
    <MainViewHeader />
    <MainViewBody>
      <div className="flex h-full flex-1 select-none items-center justify-center">
        <div className="flex flex-col items-center text-center">
          <TbBuildingCommunity className="size-24 text-foreground opacity-[0.12]" />
          <p className="mt-5 text-sm text-muted-foreground/55">{translate("welcome")}</p>
        </div>
      </div>
    </MainViewBody>
  </MainViewLayout>;
}
