/**
 * Widget entry (#29): wires the canvas to the MCP Apps host via the
 * ext-apps `App` client. Handlers are registered before connect() so no
 * notification is missed; the host pushes renders through
 * `ui/notifications/tool-result`. Bundled into ONE self-contained
 * dist/app.html by build.mjs (text/html;profile=mcp-app — nothing remote).
 */
import { App } from '@modelcontextprotocol/ext-apps';
import type { AppView } from './mount';
import { wireBridge } from './bridge';

declare const __APP_VIEW_VERSION__: string | undefined;
const VERSION = typeof __APP_VIEW_VERSION__ === 'string' ? __APP_VIEW_VERSION__ : 'dev';

declare global {
  interface Window {
    topodraftAppView: AppView;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('app-view root element missing');

const app = new App({ name: 'topodraft', version: VERSION });
window.topodraftAppView = wireBridge(root, app).view;
app.connect().catch((e: Error) => {
  window.topodraftAppView.showError(`host connection failed: ${e.message}`);
});
