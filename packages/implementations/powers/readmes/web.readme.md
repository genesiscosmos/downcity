# Web

Provides WebPower-owned search, document reading, and browser sessions to an Agent.

Desktop works without manual CDP setup: built-in Fetch reads static pages and Local Chrome starts on demand. Configure Tavily, Exa, or DeepSeek for search, and optionally Firecrawl or DeepSeek for Markdown documents. Search Auto selects the first configured key in Tavily → Exa → DeepSeek order. DeepSeek Search and Fetch share one key, configured in Web or through `DEEPSEEK_API_KEY`; select DeepSeek separately for document reading. API keys entered in Web settings are masked after saving, and a key that is not configured yet shows a link to the provider's console.

## Desktop workspace

Web provides a complete configuration page with capability tabs and a General tab. Each capability includes its Provider selector, enable switch, credentials, and parameters. Browser settings also list the sessions owned by the provider. API keys are never returned; only their configured status is shown. Configuration is edited in place without a separate Config panel.
- **通用** holds the parameters shared by all three capabilities (operation timeout, observation character limit) and the config file path with a button to reveal it.

Search, document reading, and browser each have their own on/off switch. Turning a capability off is not the same as choosing a provider, so `Off` is not listed among the providers. The operation timeout and observation character limit are shared by all three capabilities and appear on each capability page.

Web settings are global: one configuration serves every Agent and Workspace, so the workspace asks for no execution scope. Saving is field-scoped: picking a provider submits only its own field, so it never overwrites unsaved input elsewhere on the page.

Creating, observing, and closing browser sessions still happens through Agent actions, so the page
never holds a browser on its own.
