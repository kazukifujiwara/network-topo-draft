/**
 * Webview HTML skeleton. Pure string builder so it is unit-testable without
 * the VSCode API. CSP: no remote code, scripts only with our nonce, styles
 * only from the extension (dynamic styling uses CSSOM, never inline styles).
 */

export interface WebviewHtmlOptions {
  cspSource: string;
  nonce: string;
  scriptUri: string;
  styleUri: string;
  /** VSCode display language (vscode.env.language), e.g. 'en', 'ja' (D13). */
  locale: string;
  /** Host bundle's BUILD_ID — the webview warns when its own id differs. */
  buildId: string;
}

export function buildWebviewHtml(o: WebviewHtmlOptions): string {
  const locale = /^[a-zA-Z-]+$/.test(o.locale) ? o.locale : 'en';
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src ${o.cspSource} data:; style-src ${o.cspSource}; font-src ${o.cspSource}; script-src 'nonce-${o.nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${o.styleUri}">
  <title>TopoDraft</title>
</head>
<body>
  <div id="root" data-locale="${locale}" data-build="${/^[a-z0-9-]+$/.test(o.buildId) ? o.buildId : 'dev'}"></div>
  <script nonce="${o.nonce}" src="${o.scriptUri}"></script>
</body>
</html>`;
}
