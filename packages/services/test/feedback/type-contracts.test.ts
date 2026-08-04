/**
 * Feedback 服务类型契约测试。
 */

import { Federation } from "@downcity/city";
import {
  FeedbackService,
  feedbackMessages,
  type FeedbackCreateInput,
  type FeedbackMessage,
  type FeedbackStatus,
} from "../../src/index.js";

const base = new Federation({
  database: {} as never,
});

const service = new FeedbackService();
base.use(service);

const status: FeedbackStatus = "open";
const input: FeedbackCreateInput = {
  message: "hello",
  contact: "user@example.com",
  meta: { page: "/settings" },
};
const message: FeedbackMessage = {
  feedback_id: "fb_1",
  bureau_id: "product_1",
  user_id: "user_1",
  message: String(input.message),
  contact: "user@example.com",
  status,
  reply: "",
  reply_by: "",
  replied_at: "",
  metadata_json: "{}",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

void feedbackMessages;
void message;
