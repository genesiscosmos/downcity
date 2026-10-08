# Web

Provides WebPower-owned search, document reading, and browser sessions to an Agent.

Desktop works without manual CDP setup: built-in Fetch reads static pages and Local Chrome starts on demand. Configure Tavily or Exa for search, and optionally Firecrawl for complex documents. API keys entered in Web settings are masked after saving, and a key that is not configured yet shows a link to the provider's console.

## Desktop workspace

Web contributes a first-class entry to the Desktop navigation rail with a Sidebar and a Mainview. It declares no separate Config panel: each capability is configured in place.

- **Sidebar** groups capabilities under **能力**, with a **通用** entry at the end. Each capability is a branch with a mode tag on the right (`Auto`, `Fetch`, `已关闭`, or `待配置`), expanding to its providers. Each provider row carries a status dot: green when ready, amber when it still needs credentials.
- **Mainview** shows one capability: an enable switch, the resolved provider in the toolbar description, and that capability's own parameters. The browser capability also lists the sessions the provider currently owns. API keys are never returned; only whether a key is configured.
- **通用** holds the parameters shared by all three capabilities (operation timeout, observation character limit) and the config file path with a button to reveal it.

Search, document reading, and browser each have their own on/off switch. Turning a capability off is not the same as choosing a provider, so `Off` is not listed among the providers. The operation timeout and observation character limit are shared by all three capabilities and appear on each capability page.

Web settings are global: one configuration serves every Agent and Workspace, so the workspace asks for no execution scope. Saving is field-scoped: picking a provider submits only its own field, so it never overwrites unsaved input elsewhere on the page.

Creating, observing, and closing browser sessions still happens through Agent actions, so the page
never holds a browser on its own.
