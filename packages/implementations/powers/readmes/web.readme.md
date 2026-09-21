# Web

Provides WebPower-owned search, document reading, and browser sessions to an Agent.

Desktop works without manual CDP setup: built-in Fetch reads static pages and Local Chrome starts on demand. Configure Tavily or Exa for search, and optionally Firecrawl for complex documents. API keys entered in Power settings are masked after saving.

## Desktop workspace

Web contributes a first-class entry to the Desktop navigation rail with a Sidebar and a read-only
Mainview status page; its configuration stays in the separate Config panel.

- **Sidebar** summarizes whether search, document reading, and the browser are available, and lists the browser sessions the provider currently owns.
- **Mainview** shows the provider that is actually resolved for the selected Agent and Workspace, the masked configuration summary, and every active browser session. API keys are never returned; only whether a key is configured.

Creating, observing, and closing browser sessions still happens through Agent actions, so the page
never holds a browser on its own.
