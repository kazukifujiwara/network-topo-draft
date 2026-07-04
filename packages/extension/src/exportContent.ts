/**
 * Pure content builders for the export commands (plan §4.4) — the four v7
 * Export tabs that survive as commands (JSON is the file itself, YAML is
 * gone per ADR D2). Throws TopoParseError for invalid documents.
 */
import { genDrawio, genForAi, genMarkdown, genSchemaDoc, parse } from '@topodraft/core';

export type ExportKind = 'markdown' | 'for-ai' | 'schema' | 'drawio';

export interface ExportResult {
  content: string;
  /** VSCode language id for the untitled preview document. */
  language: string;
  /** Suggested file name for "save to file" flows; `base` is the topo file's basename. */
  suggestedName: (base: string) => string;
}

export function exportContent(kind: ExportKind, documentText: string): ExportResult {
  switch (kind) {
    case 'markdown':
      return {
        content: genMarkdown(parse(documentText)),
        language: 'markdown',
        suggestedName: (base) => `${base}.md`,
      };
    case 'for-ai':
      return {
        content: genForAi(parse(documentText)),
        language: 'markdown',
        suggestedName: (base) => `${base}-for-ai.md`,
      };
    case 'schema':
      // the import-format spec for AI agents — independent of the document
      return {
        content: genSchemaDoc(),
        language: 'markdown',
        suggestedName: () => 'topodraft-schema.md',
      };
    case 'drawio':
      return {
        content: genDrawio(parse(documentText)),
        language: 'xml',
        suggestedName: (base) => `${base}.drawio`,
      };
  }
}
