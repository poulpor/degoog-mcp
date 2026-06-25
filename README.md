# degoog-mcp

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) plugin for [degoog](https://github.com/degoog-org/degoog). Exposes degoog's multi-engine search as an MCP tool for AI clients like opencode, Claude Desktop, Cursor, etc.

## Features

- **Search across multiple engines**: Aggregates results from Google, DuckDuckGo, Bing, Brave, and more
- **Rich results**: Title, URL, snippet, source provenance (which engines contributed), relevance score, and related search suggestions
- **Flexible parameters**: `query` (required), `page`, `time` (any/hour/day/week/month/year/custom), `type` (web/images/news/files), `lang` (ISO 639-1)
- **SSE transport**: Standard MCP Server-Sent Events transport

## Added features 
- **Smart Result Ranking**: Automatically sorts search results by relevance score.
- **Customizable Result Count**: 
  - **User Configurable**: Set your preferred default limit (from 1 to 100) directly in the plugin settings. Default: 5.
- **Server Renaming**: I replaced the server name `mcp-degoog` with `mcp-degoog-stgreenb` because there is now an official MCP server for degoog with the same name. This caused an issue in llama.cpp, as it was impossible to load both servers simultaneously. However, it’s useful to use the `search` tool from this MCP server in conjunction with the `scrape` tool from the official degoog MCP server, since the latter’s `search` tool can sometimes be problematic with certain models (I experienced hallucinations with the URLs returned by the tool.)
## Installation

Place the plugin in degoog's `data/plugins/degoog-mcp/` directory:

```bash
git clone https://github.com/stgreenb/degoog-mcp.git /path/to/degoog/data/plugins/degoog-mcp
```

Restart your degoog instance. The MCP endpoint will be available at:

```
http://<degoog-host>:4321/api/plugin/degoog-mcp/mcp
```

## Usage

### MCP Tool: `search`

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `page` | number | no | Page number (default: 1, max: 10) |
| `time` | string | no | Time range: `any`, `hour`, `day`, `week`, `month`, `year`, `custom` |
| `type` | string | no | Search type: `web`, `images`, `news`, `files` |
| `lang` | string | no | ISO 639-1 language code (e.g. `en`, `de`, `fr`) |

### Example (opencode config)

```jsonc
{
  "mcp": {
    "degoog": {
      "type": "remote",
      "url": "http://192.168.1.196:4321/api/plugin/degoog-mcp/mcp",
      "enabled": true
    }
  }
}
```
## Configuration

Through the plugin settings interface, you can define the default behavior of the server:

    Max Results: Set a global default for the number of results returned in every search (Input field, limit 1-100).

## Architecture

The server follows the MCP specification:

    SSE Transport: Handles persistent connections for real-time updates.
    RPC Handler: Processes JSON-RPC messages for tool discovery (tools/list) and tool execution (tools/call).
    Middleware: Includes an integrated safety layer that sorts results by score and enforces the maxResults constraint.

## How It Works

1. AI client connects via SSE to the MCP endpoint
2. Client calls `tools/list` → receives the `search` tool schema
3. Client calls `tools/call` with `{"name": "search", "arguments": {"query": "..."}}`
4. Plugin proxies the request to degoog's internal `/api/search`
5. Results are formatted as Markdown with linked titles, snippets, source attribution, and related searches

## Why degoog-mcp?

Unlike single-source search APIs (like Exa), degoog aggregates across multiple search engines, giving you broader coverage, source transparency, and privacy-friendly self-hosting.

## License

MIT
