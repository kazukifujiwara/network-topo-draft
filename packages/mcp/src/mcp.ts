/**
 * Process wiring for the TopoDraft MCP server — kept thin (see server.ts /
 * tools.ts): real file system + stdio transport. Launched by MCP clients
 * (Claude Code, Claude Desktop, …) as `topodraft-mcp`.
 */
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';

declare const __MCP_VERSION__: string | undefined;
const VERSION = typeof __MCP_VERSION__ === 'string' ? __MCP_VERSION__ : 'dev';

const server = createServer({ readFile: (path) => readFileSync(path, 'utf8') }, VERSION);
server.connect(new StdioServerTransport()).catch((e: Error) => {
  // stdout is the protocol channel — diagnostics go to stderr only
  process.stderr.write(`topodraft-mcp: ${e.message}\n`);
  process.exit(1);
});
