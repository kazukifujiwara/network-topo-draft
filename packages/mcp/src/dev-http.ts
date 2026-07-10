/**
 * DEV-ONLY harness (#30): serves createServer over Streamable HTTP so the
 * ext-apps `basic-host` example — which speaks HTTP, not stdio — can render
 * the widget (the milestone's correctness bar, see #27 findings). Run from
 * the repo root via `node packages/mcp/dev/serve-http.mjs`; never shipped
 * (the npm package publishes dist/mcp.js only).
 *
 * Stateless mode: a fresh server + transport per request, no sessions —
 * exactly enough for basic-host's tools/list → resources/read → tools/call.
 */
import { createServer as createHttpServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server';

const PORT = Number(process.env.MCP_HTTP_PORT) || 3001;
// run from the repo root: file paths in tool calls resolve against it
const appHtml = readFileSync(resolve(process.cwd(), 'packages/app-view/dist/app.html'), 'utf8');

const httpServer = createHttpServer((req, res) => {
  void (async () => {
    // CORS: basic-host runs on another localhost origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'content-type, mcp-session-id, mcp-protocol-version, last-event-id',
    );
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404).end();
      return;
    }
    const server = createServer(
      {
        readFile: (path) => readFileSync(path, 'utf8'),
        writeFile: (path, text) => writeFileSync(path, text),
      },
      'dev-http',
      { appHtml },
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  })().catch((e: Error) => {
    process.stderr.write(`dev-http: ${e.message}\n`);
    if (!res.headersSent) res.writeHead(500).end();
  });
});

httpServer.listen(PORT, () => {
  process.stderr.write(
    `topodraft-mcp dev HTTP harness on http://localhost:${PORT}/mcp\n` +
      `basic-host: SERVERS='["http://localhost:${PORT}/mcp"]' npm run start (in ext-apps/examples/basic-host)\n`,
  );
});
