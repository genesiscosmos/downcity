# MCP Power

MCP Power manages configured Model Context Protocol servers and provides one stable discovery and invocation interface. Servers are not registered as separate Powers.

Use the following actions in order:

```json
{"action":"servers"}
{"action":"tools","args":{"server_id":"filesystem"}}
{"action":"call","args":{"server_id":"filesystem","tool_name":"read_file","arguments":{"path":"/allowed/example.txt"}}}
```

The tool name and arguments must match the metadata returned by `tools`. MCP validates arguments against the server's JSON Schema before sending a request. Disabled servers and filtered tools cannot be called. Calls to enabled servers execute without approval. Installation and uninstallation require approval; Agent-side installation and uninstallation actions are not implemented yet.

This is a CLI-style structured Power interface, not a standalone shell executable. Desktop provides a Sidebar and Mainview for connection status, alongside the existing Config surface. Configuration changes take effect without registering or refreshing server Powers. Agent-side installation and configuration mutation are not implemented.

stdio servers execute locally and may run arbitrary code. Configure only servers you trust. HTTP server descriptions and results are treated as external data.

The configuration is stored in the Power config file. Use `${NAME}` in command arguments, working directories, URLs, and headers to read values from the host environment.
