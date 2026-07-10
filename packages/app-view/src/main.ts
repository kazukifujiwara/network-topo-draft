/**
 * Widget entry (#28): mounts the canvas and exposes a small handle for the
 * MCP Apps bridge (#29) and manual testing. build.mjs bundles this file
 * (with its CSS) into ONE self-contained dist/app.html — an MCP Apps UI
 * resource (text/html;profile=mcp-app) must not load anything remote.
 */
import type { AppView } from './mount';
import { mountAppView } from './mount';

declare global {
  interface Window {
    topodraftAppView: AppView;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('app-view root element missing');

window.topodraftAppView = mountAppView(root, {});
