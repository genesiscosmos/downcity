# MCP Power

MCP Power connects configured Model Context Protocol servers and exposes their tools to the agent.

stdio servers execute locally and may run arbitrary code. Configure only servers you trust. HTTP server descriptions and results are treated as external data.

The configuration is stored in the Power config file. Use `${NAME}` in command arguments, working directories, URLs, and headers to read values from the host environment.
