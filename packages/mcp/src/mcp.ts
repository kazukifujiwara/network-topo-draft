/**
 * Process wiring for the TopoDraft MCP server — kept thin (see server.ts /
 * tools.ts): real file system + stdio transport. Launched by MCP clients
 * (Claude Code, Claude Desktop, …) as `topodraft-mcp`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';
// esbuild inlines the widget document as text (see build.mjs loader) — the
// published bundle stays a single self-contained file
import APP_HTML from '../../app-view/dist/app.html';

declare const __MCP_VERSION__: string | undefined;
const VERSION = typeof __MCP_VERSION__ === 'string' ? __MCP_VERSION__ : 'dev';

const server = createServer(
  {
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, text) => writeFileSync(path, text),
  },
  VERSION,
  // MCP clients gate every call behind user approval already; --read-only
  // removes the edit tools entirely for deployments that want a hard gate
  { readOnly: process.argv.includes('--read-only'), appHtml: APP_HTML },
);
server.connect(new StdioServerTransport()).catch((e: Error) => {
  // stdout is the protocol channel — diagnostics go to stderr only
  process.stderr.write(`topodraft-mcp: ${e.message}\n`);
  process.exit(1);
});
