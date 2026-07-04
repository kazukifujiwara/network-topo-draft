/**
 * Config Context editor modal — JSON only (ADR D2; the v7 YAML tab is gone).
 * The top level must be an object; saving empty text clears the field
 * (v7 ccParse semantics).
 */
import { findDevice } from '@topodraft/core';
import type { ConfigContext } from '@topodraft/core';
import type { EditorApi } from './api';
import { T } from './strings';

/**
 * Explains what the AI agent guide is for, then hands off to the host,
 * which writes AGENTS.md (the same as the command-palette command).
 */
export function createAgentGuideModal(container: HTMLElement, onConfirm: () => void) {
  const overlay = document.createElement('div');
  overlay.id = 'guideModal';
  overlay.innerHTML = `
    <div id="guideBox">
      <div class="g-head"><b>${T('gm_title')}</b><button id="guideClose" title="×">×</button></div>
      <div class="g-body">${T('gm_body')}</div>
      <div class="g-foot">
        <button class="m-btn" id="guideCancel">${T('m_cancel')}</button>
        <button class="m-btn primary" id="guideWrite">${T('gm_write')}</button>
      </div>
    </div>`;
  container.appendChild(overlay);
  const close = (): void => {
    overlay.style.display = 'none';
  };
  overlay.querySelector('#guideClose')?.addEventListener('click', close);
  overlay.querySelector('#guideCancel')?.addEventListener('click', close);
  overlay.querySelector('#guideWrite')?.addEventListener('click', () => {
    close();
    onConfirm();
  });
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  return {
    open: (): void => {
      overlay.style.display = 'flex';
    },
    close,
    isOpen: () => overlay.style.display === 'flex',
  };
}

export function createConfigContextModal(container: HTMLElement, api: EditorApi) {
  const overlay = document.createElement('div');
  overlay.id = 'modal';
  overlay.innerHTML = `
    <div id="modalBox">
      <div id="modalHead"><b id="modalTitle">${T('cc_modal')}</b><button id="modalClose" title="×">×</button></div>
      <div id="modalBody">
        <textarea id="modalText" spellcheck="false" placeholder='{\n  "bgp": { "asn": 65010 }\n}'></textarea>
        <div id="modalFoot">
          <span class="note" id="modalNote">${T('m_cc_note')}</span>
          <button class="m-btn" id="modalCancel">${T('m_cancel')}</button>
          <button class="m-btn primary" id="modalSave">${T('m_save')}</button>
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
          note.textContent = T('t_cc_obj');
          return;
        }
        parsed = value as ConfigContext;
      } catch (e) {
        note.textContent = T('t_cc_err') + (e as Error).message;
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
