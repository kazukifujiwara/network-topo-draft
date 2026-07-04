import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HostToWebviewMessage, WebviewToHostMessage } from '@topodraft/protocol';
import type { AppHost, PersistedViewState } from '../src/app';

const HERE = dirname(fileURLToPath(import.meta.url));

export function readFixture(relativePath: string): string {
  return readFileSync(resolve(HERE, '../../../fixtures', relativePath), 'utf8');
}

export interface FakeHost {
  host: AppHost;
  posted: WebviewToHostMessage[];
  state(): PersistedViewState | undefined;
}

export function fakeHost(initial?: PersistedViewState): FakeHost {
  const posted: WebviewToHostMessage[] = [];
  let state = initial;
  return {
    host: {
      postMessage: (m) => posted.push(m),
      getState: () => state,
      setState: (s) => {
        state = s;
      },
    },
    posted,
    state: () => state,
  };
}

export function update(text: string, docVersion = 1): HostToWebviewMessage {
  return { type: 'update', text, docVersion, selfOriginated: false };
}

export function mount(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}
