/**
 * Node icons: the glyph markup lives in @topodraft/core (shared with the
 * SVG export generator); this module keeps the webview-side color mapping,
 * which goes through CSS custom properties.
 */
import type { GlyphKey } from '@topodraft/core';
import { GLYPHS } from '@topodraft/core';

export type { GlyphKey };

export const ICONS = GLYPHS;

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
