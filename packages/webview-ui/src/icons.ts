/** Node icons and role colors, ported verbatim from the frozen v7 reference. */
import type { IconKey } from '@topodraft/core';

/** Extra webview-only glyph keys beyond the core role classification. */
export type GlyphKey = IconKey | 'network';

export const ICONS: Record<GlyphKey, string> = {
  router:
    '<circle cx="12" cy="12" r="9"/><path d="M8 9.5h5m0 0-1.8-1.8M13 9.5l-1.8 1.8M16 14.5h-5m0 0 1.8-1.8M11 14.5l1.8 1.8"/>',
  switch:
    '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10.2h4m0 0-1.5-1.4M11 10.2l-1.5 1.4M17 13.8h-4m0 0 1.5-1.4M13 13.8l1.5 1.4"/>',
  firewall:
    '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 9.7h16M4 14.3h16M9.3 5v4.7M14.7 9.7v4.6M9.3 14.3V19"/>',
  cloud:
    '<path d="M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17.1 8.7 4.2 4.2 0 0 1 16.8 18H7Z"/>',
  server:
    '<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01M12 7.5h4M12 16.5h4"/>',
  generic:
    '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  pnet: '<path d="M6.5 15.5a3.5 3.5 0 0 1-.5-6.96A4.8 4.8 0 0 1 15.3 7.4 3.6 3.6 0 0 1 15 14.5"/><path d="M4 19h16M7.5 15.5V19M12 14.5V19M16.5 14.5V19"/>',
  network:
    '<path d="M3 12h18"/><path d="M7 12v4.5M12 12V7.5M17 12v4.5"/><circle cx="7" cy="18" r="1.5"/><circle cx="12" cy="6" r="1.5"/><circle cx="17" cy="18" r="1.5"/>',
};

/** CSS custom-property color per icon key (values defined in styles.css). */
export const ROLE_COLOR: Record<GlyphKey, string> = {
  router: 'var(--c-router)',
  switch: 'var(--c-switch)',
  firewall: 'var(--c-firewall)',
  cloud: 'var(--c-cloud)',
  server: 'var(--c-server)',
  generic: 'var(--c-generic)',
  pnet: 'var(--c-pnet)',
  network: 'var(--c-network)',
};
