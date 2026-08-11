/** 与 Duobox WelcomeMainView 完全相同结构的 Downcity 欢迎页。 */

import { TbBuildingCommunity } from "react-icons/tb";
import { MainViewBody, MainViewLayout } from "@/layouts/MainViewLayout";

/** 中间主视图的空状态。 */
export function WelcomeView() {
  return <MainViewLayout>
    <div className="header-drag-region h-10 w-full flex-none" />
    <MainViewBody>
      <div className="flex h-full flex-1 select-none items-center justify-center">
        <div className="flex flex-col items-center text-center">
          <TbBuildingCommunity className="size-24 text-foreground opacity-[0.12]" />
          <p className="mt-5 text-sm text-muted-foreground/55">选择一个 Agent 开始使用 Downcity</p>
        </div>
      </div>
    </MainViewBody>
  </MainViewLayout>;
}
