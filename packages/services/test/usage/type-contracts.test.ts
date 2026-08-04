/**
 * Usage 服务类型契约测试。
 */

import { AIService, Federation } from "@downcity/city";
import {
  CreditsService,
  UsageService,
  type UserRecentTokenUsageResponse,
} from "../../src/index.js";

const base = new Federation({
  database: {} as never,
});

const ai_service = new AIService();
const credits_service = new CreditsService();

base.use(ai_service);
base.use(credits_service);
base.use(new UsageService({
  ai_usage_reader: ai_service,
  credits_usage_reader: credits_service,
}));

const recent_usage_response: UserRecentTokenUsageResponse = {
  items: [],
  next_cursor: null,
};
void recent_usage_response;
