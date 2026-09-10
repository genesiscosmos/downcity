# Chat

Connects Bot Accounts to Agent Sessions through Telegram, Feishu / Lark, and QQ.

## Bot Accounts

- City owns one Chat Plugin runtime and its reliable Inbox/Outbox.
- Multiple Accounts can use the same provider.
- Each Account selects a default Agent and Workspace for new Conversations.
- Credentials stay in City Plugin Config and are never copied into Agent state.
- Desktop applies Account changes immediately by restarting only that Connector.

## Conversations

Each external Conversation maps to one real Agent Session. Session Messages are the canonical conversation history. Chat only stores routing, delivery state, Access, and diagnostic Activity.

In Desktop, use the plus button in the Channels Sidebar header to choose Telegram, Feishu/Lark, or QQ and create the corresponding Bot Account.
