/**
 * Config Context editor modal — JSON only (ADR D2; the v7 YAML tab is gone).
 * The top level must be an object; saving empty text clears the field
 * (v7 ccParse semantics).
 */
import { findDevice } from '@topodraft/core';
import type { ConfigContext } from '@topodraft/core';
import type { EditorApi } from './api';

export function createConfigContextModal(container: HTMLElement, api: EditorApi) {
  const overlay = document.createElement('div');
  overlay.id = 'modal';
  overlay.innerHTML = `
    <div id="modalBox">
      <div id="modalHead"><b id="modalTitle">Config Context</b><button id="modalClose" title="Close">×</button></div>
      <div id="modalBody">
        <textarea id="modalText" spellcheck="false" placeholder='{\n  "bgp": { "asn": 65010 }\n}'></textarea>
        <div id="modalFoot">
          <span class="note" id="modalNote">Free-form structured settings for this device (JSON object). Stored as devices[].config_context and re-emitted verbatim. Save with empty text to clear.</span>
          <button class="m-btn" id="modalCancel">Cancel</button>
          <button class="m-btn primary" id="modalSave">Save</button>
        </div>
      </div>
    </div>`;
  container.appendChild(overlay);
  const text = overlay.querySelector('#modalText') as HTMLTextAreaElement;
  const title = overlay.querySelector('#modalTitle') as HTMLElement;
  const note = overlay.querySelector('#modalNote') as HTMLElement;
  const defaultNote = note.textContent ?? '';
  let deviceName: string | null = null;

  const close = (): void => {
    overlay.style.display = 'none';
    deviceName = null;
  };
  const save = (): void => {
    if (deviceName === null) return close();
    const raw = text.value.trim();
    let parsed: ConfigContext | null = null;
    if (raw) {
      try {
        const value: unknown = JSON.parse(raw);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          note.textContent = 'Top level must be an object (key/value map)';
          return;
        }
        parsed = value as ConfigContext;
      } catch (e) {
        note.textContent = 'Parse error: ' + (e as Error).message;
        return;
      }
    }
    const name = deviceName;
    api.mutate((m) => {
      const d = findDevice(m, name);
      if (!d) return;
      if (parsed && Object.keys(parsed).length) d.config_context = parsed;
      else delete d.config_context;
    });
    api.commit();
    api.renderPanel();
    close();
  };

  overlay.querySelector('#modalClose')?.addEventListener('click', close);
  overlay.querySelector('#modalCancel')?.addEventListener('click', close);
  overlay.querySelector('#modalSave')?.addEventListener('click', save);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    e.stopPropagation();
  });

  const open = (name: string): void => {
    if (!api.editable()) return;
    const device = findDevice(api.model(), name);
    if (!device) return;
    deviceName = name;
    title.textContent = `Config Context — ${name}`;
    note.textContent = defaultNote;
    text.value = device.config_context ? JSON.stringify(device.config_context, null, 2) : '';
    overlay.style.display = 'flex';
    text.focus();
  };

  return { open, close, isOpen: () => overlay.style.display === 'flex' };
}
