/**
 * Manifest consistency for the Get Started walkthrough (#5). Walkthroughs
 * are fully declarative, so the failure mode is silent reference rot:
 * a step pointing at a missing media file, an unregistered command, or an
 * un-localized key renders as a broken page with no error anywhere. This
 * suite makes that rot loud.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const read = (f: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(root, f), 'utf8')) as Record<string, unknown>;

const pkg = read('package.json') as {
  contributes: {
    commands: { command: string }[];
    walkthroughs: {
      id: string;
      title: string;
      description: string;
      steps: {
        id: string;
        title: string;
        description: string;
        media: { image?: string; svg?: string; altText: string };
        completionEvents?: string[];
      }[];
    }[];
  };
};
const nlsEn = read('package.nls.json') as Record<string, string>;
const nlsJa = read('package.nls.ja.json') as Record<string, string>;
const commands = new Set(pkg.contributes.commands.map((c) => c.command));
const walkthrough = pkg.contributes.walkthroughs[0];

describe('walkthrough manifest consistency', () => {
  it('contributes exactly one walkthrough with steps', () => {
    expect(pkg.contributes.walkthroughs).toHaveLength(1);
    expect(walkthrough?.steps.length).toBeGreaterThanOrEqual(4);
  });

  it('every %key% is localized in BOTH nls files', () => {
    const keys = [walkthrough!.title, walkthrough!.description];
    for (const s of walkthrough!.steps) keys.push(s.title, s.description, s.media.altText);
    for (const raw of keys) {
      expect(raw.startsWith('%') && raw.endsWith('%'), `not an nls key: ${raw}`).toBe(true);
      const key = raw.slice(1, -1);
      expect(nlsEn[key], `missing en: ${key}`).toBeTruthy();
      expect(nlsJa[key], `missing ja: ${key}`).toBeTruthy();
    }
  });

  it('every media file ships from the extension folder', () => {
    for (const s of walkthrough!.steps) {
      const media = s.media.image ?? s.media.svg;
      expect(media, `step ${s.id} has no media`).toBeTruthy();
      expect(existsSync(resolve(root, media!)), `missing media: ${media}`).toBe(true);
    }
  });

  it('every command referenced by buttons or completionEvents is contributed', () => {
    for (const s of walkthrough!.steps) {
      const refs: string[] = [];
      for (const nls of [nlsEn, nlsJa]) {
        const text = nls[s.description.slice(1, -1)] ?? '';
        for (const m of text.matchAll(/command:([a-zA-Z0-9_.]+)/g)) refs.push(m[1]!);
      }
      for (const ev of s.completionEvents ?? []) {
        const m = /^onCommand:(.+)$/.exec(ev);
        if (m) refs.push(m[1]!);
      }
      for (const cmd of refs) {
        expect(commands.has(cmd), `step ${s.id} references unregistered command ${cmd}`).toBe(true);
      }
    }
  });
});
