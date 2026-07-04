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
}

export function buildWebviewHtml(o: WebviewHtmlOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src ${o.cspSource} data:; style-src ${o.cspSource}; font-src ${o.cspSource}; script-src 'nonce-${o.nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${o.styleUri}">
  <title>Network TopoDraft</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${o.nonce}" src="${o.scriptUri}"></script>
</body>
</html>`;
}
