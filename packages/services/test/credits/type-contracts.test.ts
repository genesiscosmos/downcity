/**
 * Credits Service 公开类型契约测试。
 */

import { Federation } from "@downcity/city";
import { CreditsService } from "../../src/index.js";

async function verify_credits_service_contract(): Promise<void> {
  const federation = new Federation({ database: {} as never });
  const credits = new CreditsService();
  federation.use(credits);

  await credits.read_account("user_1");
  const card = await credits.cards.create_ephemeral({
    user_id: "user_1",
    name: "7 day trial",
    initial_credits: 100_000,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    source: "trial",
    idempotency_key: "trial:user_1",
  });
  await credits.topup({
    card: { kind: "ephemeral", card_id: card.card_id },
    credits: 20_000,
    source: "reward",
    idempotency_key: "reward:user_1",
  });
  await credits.charge({
    user_id: "user_1",
    credits: 10_000,
    source: "model_usage",
    idempotency_key: "usage:req_1",
  });
}

void verify_credits_service_contract;
