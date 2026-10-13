# Messenger

Connects Bot Accounts to Agent Sessions through Telegram, Feishu / Lark, and QQ.

## Bot Accounts

- City owns one Messenger Power runtime and its reliable Inbox/Outbox.
- Multiple Accounts can use the same provider.
- Each Account selects a default Agent for new Conversations; no Workspace binding is required.
- Credentials stay in City Power Config and are never copied into Agent state.
- Desktop applies Account changes immediately by restarting only that Connector.

## Conversations

Each external chat and thread under an Account maps to its own Channel Session (`origin.type = "channel"`), owned by the bound Agent. Histories are separate from other chats and the Agent's main conversation. Session Messages are the canonical conversation history. Messenger only stores routing, delivery state, Access, and diagnostic Activity.

Changing the bound Agent or resetting a Conversation creates a new Channel Session and preserves the previous Session. Upgrades preserve old IM Work Sessions and establish new Channel Sessions. Agent main and Channel Sessions load the same Session management tools. In Desktop they default to the Agent's shared main Workspace, with the same Workspace tools, Powers, and custom Agent tools. SDK hosts provide the default context through the Agent's `workspace` option. Histories stay separate; file and Shell context follow the current Workspace.

In Desktop, use the plus button in the Messengers Sidebar header to choose Telegram, Feishu/Lark, or QQ and create the corresponding Bot Account.
