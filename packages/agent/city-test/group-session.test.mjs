import test from "node:test";
import assert from "node:assert/strict";
import { Agent, City, Group, Session } from "../bin/index.js";

class RecordingSession extends Session {
  static created = [];

  async prompt(input) {
    RecordingSession.created.push({ agent_id: this.agent_id, query: input.query });
    return {
      id: `turn-${this.id}`,
      result: null,
      finished: Promise.resolve({
        turn_id: `turn-${this.id}`,
        text: `reply:${this.agent_id}`,
        success: true,
      }),
    };
  }
}

test("GroupSession routes execution to member AgentSessions", async () => {
  RecordingSession.created = [];
  const city = new City();
  const lead = new Agent({ id: "lead", session_class: RecordingSession });
  const reviewer = new Agent({ id: "reviewer", session_class: RecordingSession });
  city.agents.add(lead);
  city.agents.add(reviewer);

  const group = new Group({
    id: "delivery",
    members: [
      { agent: lead, role: "coordinator" },
      { agent: reviewer, role: "reviewer" },
    ],
    coordinator_id: "lead",
  });
  city.groups.add(group);
  const group_session = await group.sessions.create();

  const first = await group_session.prompt({ query: "implement" });
  const second = await group_session.prompt({ query: "review", agent_id: "reviewer" });
  assert.equal((await first.finished).agent_id, "lead");
  assert.equal((await second.finished).agent_id, "reviewer");
  assert.deepEqual(
    RecordingSession.created.map((entry) => entry.agent_id),
    ["lead", "reviewer"],
  );
  assert.deepEqual(
    group_session.messages().map((message) => [message.author_type, message.author_id, message.text]),
    [
      ["user", undefined, "implement"],
      ["agent", "lead", "reply:lead"],
      ["user", undefined, "review"],
      ["agent", "reviewer", "reply:reviewer"],
    ],
  );
  await city.close();
});
