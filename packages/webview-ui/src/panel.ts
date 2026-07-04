/**
 * Property panel, ported from v7 `renderPanel()` (minus templates and the
 * language toggle — plan §5). Field edits follow the v7 commit granularity:
 * 'input' events mutate the working model and re-render the canvas,
 * 'change' events (blur/Enter) commit — one undo step per field edit (D6).
 *
 * CSP note: markup contains no style attributes; dynamic colors are applied
 * via CSSOM after insertion.
 */
import type { Cable, Circuit, Device, LogicalLink, ProviderNetwork, Topology } from '@topodraft/core';
import {
  allVrfs,
  deriveDeviceVrfs,
  findDevice,
  findProviderNetwork,
  iconKey,
  setLogicalEndpointInterface,
  setLogicalEndpointIp,
  siteOf,
  sitesList,
  vrfColor,
  convertCableToCircuit,
  convertCircuitToCable,
} from '@topodraft/core';
import type { EditorApi, LinkRef } from './api';

const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

function fld(key: string, value: string | undefined, ph: string, listId?: string, disp?: string): string {
  return `<div class="fld"><label>${esc(disp ?? key)}</label>
    <input value="${esc(value ?? '')}" placeholder="${esc(ph)}" data-f="${esc(key)}" ${listId ? `list="${listId}"` : ''} spellcheck="false"></div>`;
}

function datalists(t: Topology): string {
  const opt = (v: string): string => `<option value="${esc(v)}">`;
  const sites = sitesList(t).map(opt).join('');
  const roles = ['router', 'switch', 'firewall', 'external_peer', 'server', 'load_balancer', 'access_point']
    .map(opt)
    .join('');
  const status = ['connected', 'planned', 'active', 'provisioning', 'decommissioning', 'offline']
    .map(opt)
    .join('');
  const vrfs = allVrfs(t).map(opt).join('');
  const tenants = [...new Set(t.devices.map((d) => (d.tenant ?? '').trim()).filter(Boolean))]
    .map(opt)
    .join('');
  return `<datalist id="dlSites">${sites}</datalist><datalist id="dlRoles">${roles}</datalist>
          <datalist id="dlStatus">${status}</datalist><datalist id="dlVrfs">${vrfs}</datalist>
          <datalist id="dlTenants">${tenants}</datalist>`;
}

/** input → mutate; change → commit (v7 bindPanelInputs). */
function bindFields(
  panel: HTMLElement,
  api: EditorApi,
  target: Record<string, unknown>,
  opts?: { skip?: string[] },
): void {
  panel.querySelectorAll<HTMLInputElement>('input[data-f]').forEach((inp) => {
    const key = inp.getAttribute('data-f') as string;
    if (opts?.skip?.includes(key)) return;
    inp.addEventListener('input', () => {
      api.mutate(() => {
        if (inp.value) target[key] = inp.value;
        else delete target[key];
      });
    });
    inp.addEventListener('change', () => api.commit());
  });
}

function actionsRow(withDelete = true): string {
  return `<div class="pn-actions">
    <button data-act="copy">Copy</button>
    <button data-act="dup">Duplicate</button>
    ${withDelete ? '<button data-act="del" class="danger">Delete</button>' : ''}
  </div>`;
}

function bindActions(panel: HTMLElement, api: EditorApi): void {
  panel.querySelector('[data-act="copy"]')?.addEventListener('click', () => api.copySelection());
  panel.querySelector('[data-act="dup"]')?.addEventListener('click', () => api.duplicateSelection());
  panel.querySelector('[data-act="del"]')?.addEventListener('click', () => api.deleteSelection());
}

/** Rename via core op on change only (references must follow, ADR D10). */
function bindRename(panel: HTMLElement, api: EditorApi, currentName: string): void {
  const inp = panel.querySelector<HTMLInputElement>('input[data-f="name"]');
  inp?.addEventListener('change', () => {
    const v = inp.value.trim();
    if (v && v !== currentName) api.renameNode(currentName, v);
    else inp.value = currentName;
  });
}

export function renderPanel(panel: HTMLElement, api: EditorApi): void {
  if (!api.editable()) {
    panel.innerHTML = `<div class="pn-title">Network TopoDraft</div>
      <div class="pn-info">The document has a JSON error — the canvas shows the last valid state and editing is paused until the text parses again.</div>`;
    return;
  }
  const t = api.model();
  const nodes = api.selectedNodes();
  const linkRef = api.selectedLink();

  if (!linkRef && nodes.size > 1) return renderMulti(panel, api, t, nodes);
  if (!linkRef && nodes.size === 1) {
    const name = [...nodes][0] as string;
    const device = findDevice(t, name);
    if (device) return renderDevice(panel, api, t, device);
    const pn = findProviderNetwork(t, name);
    if (pn) return renderPn(panel, api, t, pn);
  }
  if (linkRef) {
    const link = (t[linkRef.col] ?? [])[linkRef.idx];
    if (link) {
      if (linkRef.col === 'logical_links') {
        return renderLogicalLink(panel, api, t, link as LogicalLink, linkRef);
      }
      return renderPhysicalLink(panel, api, t, link as Cable | Circuit, linkRef);
    }
  }
  panel.innerHTML = `<div class="pn-title">Network TopoDraft</div>
    <div class="pn-info">
      <b>Physical</b> shows cables and carrier circuits; <b>Logical</b> shows VRF
      compartments connected by logical links.<br><br>
      Drag from a node's <b>◦ port</b> to connect. <b>Shift</b>+click or
      <b>Shift</b>+drag to multi-select. Double-click renames. Right-click for
      the context menu.<br><br>
      <b>Ctrl/Cmd+C/V/D</b> copy · paste · duplicate — <b>Del</b> delete —
      <b>arrows</b> nudge — undo/redo is VSCode's regular <b>Ctrl/Cmd+Z</b>.
    </div>`;
}

/* ---------- multi selection ---------- */

function renderMulti(panel: HTMLElement, api: EditorApi, t: Topology, nodes: ReadonlySet<string>): void {
  panel.innerHTML = `
    ${datalists(t)}
    <div class="pn-title">Selection <span class="badge">${nodes.size} nodes</span></div>
    <div class="fld"><label>set site for all selected devices</label>
      <input id="bulkSite" list="dlSites" placeholder="site name…" spellcheck="false"></div>
    <button class="mini-btn" id="bulkSiteApply">Apply site</button>
    <div class="pn-sep"></div>
    <div class="pn-title">Arrange</div>
    <div class="align-row">
      <button data-arr="row" title="Same Y — align in one horizontal row">═ Row</button>
      <button data-arr="col" title="Same X — align in one vertical column">║ Column</button>
    </div>
    <div class="align-row">
      <button data-arr="dh" title="Even horizontal spacing (3+ nodes)">↔ Distribute</button>
      <button data-arr="dv" title="Even vertical spacing (3+ nodes)">↕ Distribute</button>
    </div>
    ${actionsRow()}`;
  panel.querySelectorAll<HTMLButtonElement>('[data-arr]').forEach((b) =>
    b.addEventListener('click', () => api.arrange(b.getAttribute('data-arr') as 'row')),
  );
  panel.querySelector('#bulkSiteApply')?.addEventListener('click', () => {
    const v = (panel.querySelector('#bulkSite') as HTMLInputElement).value.trim();
    api.mutate((m) => {
      for (const name of nodes) {
        const d = findDevice(m, name);
        if (d) {
          if (v) d.site = v;
          else delete d.site;
        }
      }
    });
    api.commit();
    api.renderPanel();
  });
  bindActions(panel, api);
}

/* ---------- provider network ---------- */

function renderPn(panel: HTMLElement, api: EditorApi, t: Topology, pn: ProviderNetwork): void {
  panel.innerHTML = `
    ${datalists(t)}
    <div class="pn-title">Provider network <span class="badge">circuit endpoint</span></div>
    ${fld('name', pn.name, 'e.g. AWS Direct Connect')}
    ${fld('provider', pn.provider, 'e.g. AWS / Oracle / Equinix')}
    ${fld('description', pn.description, '')}
    <div class="pn-sep"></div>
    <div class="pn-info">A provider network is a carrier-side network (DX, FastConnect, IP-VPN cloud …). Links attached to it are always <b>circuits</b>. In the file it lives in <b>provider_networks[]</b>.</div>
    ${actionsRow()}`;
  bindRename(panel, api, pn.name);
  bindFields(panel, api, pn as unknown as Record<string, unknown>, { skip: ['name'] });
  bindActions(panel, api);
}

/* ---------- device ---------- */

function renderDevice(panel: HTMLElement, api: EditorApi, t: Topology, d: Device): void {
  const explicit = new Set((d.vrfs ?? []).map((v) => v.trim()).filter(Boolean));
  const derivedVrfs = deriveDeviceVrfs(t, d.name);
  const vchips = derivedVrfs
    .map((v) => {
      const derived = !explicit.has(v);
      return `<span class="vchip${derived ? ' derived' : ''}" title="${derived ? 'defined by an interface or logical link' : 'routing instance'}">
        <span class="vd" data-vrfdot="${esc(v)}"></span>${esc(v)}
        ${derived ? '' : `<button data-vdel="${esc(v)}" title="Remove VRF">×</button>`}</span>`;
    })
    .join('');
  const ifs = (d.interfaces ?? [])
    .map(
      (f, i) => `
      <div class="if-card">
        <div class="if-row">
          <input data-if="${i}" data-k="name" value="${esc(f.name)}" placeholder="Gi0/0/1 or Gi0/0/1.100" spellcheck="false">
          <input data-if="${i}" data-k="ip_address" value="${esc(f.ip_address)}" placeholder="10.0.0.1/30" spellcheck="false">
          <button class="if-del" data-ifdel="${i}" title="Delete">×</button>
        </div>
        <div class="if-row3">
          <input data-if="${i}" data-k="type" value="${esc(f.type)}" placeholder="type / lag / virtual" spellcheck="false">
          <input data-if="${i}" data-k="lag" value="${esc(f.lag)}" placeholder="lag parent (Po1)" spellcheck="false">
          <input data-if="${i}" data-k="vrf" value="${esc(f.vrf)}" placeholder="vrf" list="dlVrfs" spellcheck="false">
        </div>
        <div class="if-row1">
          <input data-if="${i}" data-k="description" value="${esc(f.description)}" placeholder="description" spellcheck="false">
        </div>
      </div>`,
    )
    .join('');
  const ccPreview = d.config_context
    ? JSON.stringify(d.config_context, null, 1).split('\n').slice(0, 8).join('\n') +
      (JSON.stringify(d.config_context, null, 1).split('\n').length > 8 ? '\n…' : '')
    : '';
  panel.innerHTML = `
    ${datalists(t)}
    <div class="pn-title">Device <span class="badge">${esc(iconKey(d.role))}</span></div>
    ${fld('name', d.name, 'hostname')}
    <div class="fld-row">
      ${fld('role', d.role, 'router / fw / …', 'dlRoles')}
      ${fld('site', d.site, 'site name', 'dlSites')}
    </div>
    <div class="fld-row">
      ${fld('tenant', d.tenant, 'owning org', 'dlTenants')}
      ${fld('platform', d.platform, 'OS')}
    </div>
    ${fld('device_type', d.device_type, 'vendor + model (e.g. Cisco C8300)')}
    <div class="pn-sep"></div>
    <div class="pn-title">VRF instances <span class="badge">${derivedVrfs.length}</span></div>
    <div class="vchips">${vchips || '<span class="pn-dim">Only the global routing table</span>'}</div>
    <div id="vrfAddRow">
      <input id="vrfNew" placeholder="Add VRF (e.g. PROD)" list="dlVrfs" spellcheck="false">
      <button id="vrfAdd">Add</button>
    </div>
    <div class="pn-sep"></div>
    <div class="pn-title">Interfaces <span class="badge">${(d.interfaces ?? []).length}</span></div>
    ${ifs || '<div class="pn-dim">None yet — subinterfaces (Gi0/0/1.100), LAG parents (lag) and VRFs are supported</div>'}
    <button class="mini-btn" id="ifAdd">+ Add interface</button>
    <div class="pn-sep"></div>
    <div class="pn-title">Config Context <span class="badge">${d.config_context ? Object.keys(d.config_context).length : '—'}</span></div>
    ${d.config_context ? `<div class="cc-preview" id="ccPreview" title="Edit config context (JSON)">${esc(ccPreview)}</div>` : ''}
    <button class="mini-btn" id="ccEdit">Edit config context (JSON)</button>
    ${actionsRow()}`;
  panel.querySelectorAll<HTMLElement>('[data-vrfdot]').forEach((dot) => {
    dot.style.background = vrfColor(dot.getAttribute('data-vrfdot') ?? '');
  });
  bindRename(panel, api, d.name);
  bindFields(panel, api, d as unknown as Record<string, unknown>, { skip: ['name'] });
  const addVrf = (): void => {
    const inp = panel.querySelector('#vrfNew') as HTMLInputElement;
    const v = inp.value.trim();
    if (!v) return;
    api.mutate((m) => {
      const dev = findDevice(m, d.name);
      if (!dev) return;
      dev.vrfs = dev.vrfs ?? [];
      if (!dev.vrfs.includes(v)) dev.vrfs.push(v);
    });
    api.commit();
    api.renderPanel();
  };
  panel.querySelector('#vrfAdd')?.addEventListener('click', addVrf);
  panel.querySelector('#vrfNew')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') addVrf();
    e.stopPropagation();
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-vdel]').forEach((b) =>
    b.addEventListener('click', () => {
      const v = b.getAttribute('data-vdel');
      api.mutate((m) => {
        const dev = findDevice(m, d.name);
        if (dev) dev.vrfs = (dev.vrfs ?? []).filter((x) => x !== v);
      });
      api.commit();
      api.renderPanel();
    }),
  );
  panel.querySelectorAll<HTMLInputElement>('input[data-if]').forEach((inp) => {
    const i = Number(inp.getAttribute('data-if'));
    const k = inp.getAttribute('data-k') as keyof NonNullable<Device['interfaces']>[number];
    inp.addEventListener('input', () => {
      api.mutate((m) => {
        const f = findDevice(m, d.name)?.interfaces?.[i];
        if (!f) return;
        if (inp.value) f[k] = inp.value;
        else delete f[k];
      });
    });
    inp.addEventListener('change', () => api.commit());
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-ifdel]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number(b.getAttribute('data-ifdel'));
      api.mutate((m) => {
        findDevice(m, d.name)?.interfaces?.splice(i, 1);
      });
      api.commit();
      api.renderPanel();
    }),
  );
  panel.querySelector('#ifAdd')?.addEventListener('click', () => {
    // The new interface is committed once it has content — an empty one
    // cannot exist in the canonical file (spec §4 rule 5).
    api.mutate((m) => {
      const dev = findDevice(m, d.name);
      if (!dev) return;
      dev.interfaces = dev.interfaces ?? [];
      dev.interfaces.push({});
    });
    api.renderPanel();
  });
  panel.querySelector('#ccEdit')?.addEventListener('click', () => api.openConfigContext(d.name));
  panel.querySelector('#ccPreview')?.addEventListener('click', () => api.openConfigContext(d.name));
  bindActions(panel, api);
}

/* ---------- logical link ---------- */

function renderLogicalLink(
  panel: HTMLElement,
  api: EditorApi,
  t: Topology,
  l: LogicalLink,
  ref: LinkRef,
): void {
  const epBox = (side: 'a' | 'b'): string => {
    const ep = l[side];
    if (ep.provider_network !== undefined) {
      const pn = findProviderNetwork(t, ep.provider_network);
      return `<div class="ep-box" data-ep-side="${side}">
        <div class="ep-dev">${esc(ep.provider_network)} <span class="ep-site">Provider network${pn?.provider ? ' · ' + esc(pn.provider) : ''}</span></div>
        <div class="ep-lbl">ID (attachment / VC / VIF …)</div>
        <input data-epid="${side}" value="${esc(ep.id)}" placeholder="e.g. dxvif-xxxx / ocid1.vc…" spellcheck="false">
      </div>`;
    }
    const dev = ep.device !== undefined ? findDevice(t, ep.device) : undefined;
    const ifn = ep.interface ?? '';
    const curIf = dev?.interfaces?.find((f) => f.name === ifn);
    const ip = ifn ? (curIf?.ip_address ?? '') : (ep.ip_address ?? '');
    const vrfOpts = dev
      ? `<datalist id="dlv_${side}">${deriveDeviceVrfs(t, dev.name)
          .map((v) => `<option value="${esc(v)}">`)
          .join('')}</datalist>`
      : '';
    const ifOpts = dev
      ? `<datalist id="dli_${side}">${(dev.interfaces ?? [])
          .map((f) => `<option value="${esc(f.name)}">`)
          .join('')}</datalist>`
      : '';
    return `<div class="ep-box" data-ep-side="${side}">
      <div class="ep-dev">${esc(ep.device ?? '(unresolved)')} <span class="ep-site">${esc(dev ? siteOf(dev) || '(no site)' : 'missing device')}</span></div>
      ${vrfOpts}${ifOpts}
      <div class="ep-grid">
        <div><div class="ep-lbl">VRF (empty = global)</div>
          <input data-epv="${side}" list="dlv_${side}" value="${esc(ep.vrf)}" placeholder="global" spellcheck="false"></div>
        <div><div class="ep-lbl">ID (tenant / attach …)</div>
          <input data-epid="${side}" value="${esc(ep.id)}" placeholder="optional" spellcheck="false"></div>
      </div>
      <div class="ep-grid">
        <div><div class="ep-lbl">interface (subIF ok)</div>
          <input data-epi="${side}" list="dli_${side}" value="${esc(ifn)}" placeholder="Gi0/0/1.100" spellcheck="false"></div>
        <div><div class="ep-lbl">ip_address</div>
          <input data-epip="${side}" value="${esc(ip)}" placeholder="10.0.0.1/30" spellcheck="false"></div>
      </div>
    </div>`;
  };
  panel.innerHTML = `
    ${datalists(t)}
    <div class="pn-title">Logical link <span class="badge">L3 / VRF</span></div>
    ${epBox('a')}
    <div class="ep-mid">▲▼</div>
    ${epBox('b')}
    <div class="pn-sep"></div>
    <div class="fld-row">
      ${fld('link_id', l.link_id, 'VC / VIF ID — shown on diagram')}
      ${fld('vlan', l.vlan, 'VLAN ID')}
    </div>
    ${fld('label', l.label, 'e.g. eBGP / OSPF area 0')}
    ${fld('description', l.description, '')}
    <div class="pn-dim">With an interface set, the ip_address is written to that interface on the device (created if missing). Without one, the IP stays on this endpoint.</div>
    <div class="pn-actions"><button data-act="dellink" class="danger">Delete link</button></div>`;
  panel.querySelectorAll<HTMLElement>('[data-ep-side]').forEach((box) => {
    const side = box.getAttribute('data-ep-side') as 'a' | 'b';
    box.style.borderLeft = `3px solid ${vrfColor((l[side].vrf ?? '').trim())}`;
  });
  bindFields(panel, api, l as unknown as Record<string, unknown>);
  const epInput = (attr: string, handler: (side: 'a' | 'b', inp: HTMLInputElement) => void): void =>
    panel.querySelectorAll<HTMLInputElement>(`input[${attr}]`).forEach((inp) => {
      handler(inp.getAttribute(attr) as 'a' | 'b', inp);
    });
  epInput('data-epv', (side, inp) => {
    inp.addEventListener('input', () =>
      api.mutate((m) => {
        const link = m.logical_links?.[ref.idx];
        if (!link) return;
        if (inp.value) link[side].vrf = inp.value;
        else delete link[side].vrf;
      }),
    );
    inp.addEventListener('change', () => {
      api.commit();
      api.renderPanel();
    });
  });
  epInput('data-epid', (side, inp) => {
    inp.addEventListener('input', () =>
      api.mutate((m) => {
        const link = m.logical_links?.[ref.idx];
        if (!link) return;
        if (inp.value) link[side].id = inp.value;
        else delete link[side].id;
      }),
    );
    inp.addEventListener('change', () => api.commit());
  });
  epInput('data-epi', (side, inp) => {
    inp.addEventListener('change', () => {
      // core op: an endpoint-held IP migrates onto the newly named interface
      api.apply((m) => setLogicalEndpointInterface(m, ref.idx, side, inp.value.trim()));
    });
  });
  epInput('data-epip', (side, inp) => {
    inp.addEventListener('change', () => {
      // core op: write-through to the device interface when one is named
      api.apply((m) => setLogicalEndpointIp(m, ref.idx, side, inp.value.trim()));
    });
  });
  panel
    .querySelector('[data-act="dellink"]')
    ?.addEventListener('click', () => api.deleteSelection());
}

/* ---------- physical link (cable / circuit) ---------- */

function renderPhysicalLink(
  panel: HTMLElement,
  api: EditorApi,
  t: Topology,
  l: Cable | Circuit,
  ref: LinkRef,
): void {
  const isCable = ref.col === 'cables';
  const hasPn = l.a.provider_network !== undefined || l.b.provider_network !== undefined;
  const epBox = (side: 'a' | 'b'): string => {
    const ep = l[side];
    if (ep.provider_network !== undefined) {
      const pn = findProviderNetwork(t, ep.provider_network);
      return `<div class="ep-box"><div class="ep-dev">${esc(ep.provider_network)} <span class="ep-site">Provider network${pn?.provider ? ' · ' + esc(pn.provider) : ''}</span></div></div>`;
    }
    const dev = ep.device !== undefined ? findDevice(t, ep.device) : undefined;
    const ifOpts = dev
      ? `<datalist id="dlpi_${side}">${(dev.interfaces ?? [])
          .map((f) => `<option value="${esc(f.name)}">`)
          .join('')}</datalist>`
      : '';
    return `<div class="ep-box">
      <div class="ep-dev">${esc(ep.device ?? '(unresolved)')} <span class="ep-site">${esc(dev ? siteOf(dev) || '(no site)' : 'missing device')}</span></div>
      ${ifOpts}
      <input data-pep="${side}" list="dlpi_${side}" value="${esc(ep.interface)}" placeholder="interface (e.g. Gi0/0/1)" spellcheck="false">
    </div>`;
  };
  const common = isCable
    ? fld('type', (l as Cable).type, 'cat6 / smf / dac …') +
      `<div class="fld-row">${fld('bandwidth', (l as Cable).bandwidth, 'e.g. 10Gbps / 2x10G LAG')}${fld('status', (l as Cable).status, 'connected', 'dlStatus')}</div>` +
      fld('label', (l as Cable).label, '')
    : fld('cid', (l as Circuit).cid, 'circuit ID') +
      fld('provider', (l as Circuit).provider, 'carrier (e.g. NTT Com)') +
      `<div class="fld-row">${fld('type', (l as Circuit).type, 'leased line / DX …')}${fld('commit_rate', (l as Circuit).commit_rate, 'bandwidth, e.g. 1Gbps')}</div>` +
      fld('status', (l as Circuit).status, 'active / provisioning', 'dlStatus');
  panel.innerHTML = `
    ${datalists(t)}
    <div class="pn-title">Physical link <span class="badge">${isCable ? 'Cable / local' : 'Circuit / carrier'}</span></div>
    <div class="seg">
      <button id="segCable" class="${isCable ? 'on' : ''}" ${hasPn ? 'disabled title="Provider-network links must be circuits"' : ''}>cable</button>
      <button id="segCircuit" class="${isCable ? '' : 'on'}">circuit</button>
    </div>
    ${epBox('a')}
    <div class="ep-mid">▲▼</div>
    ${epBox('b')}
    <div class="pn-sep"></div>
    ${common}
    <div class="pn-actions"><button data-act="dellink" class="danger">Delete link</button></div>`;
  panel.querySelector('#segCircuit')?.addEventListener('click', () => {
    if (isCable) {
      api.apply((m) => convertCableToCircuit(m, ref.idx));
      api.selectLink({ col: 'circuits', idx: (api.model().circuits ?? []).length - 1 });
    }
  });
  panel.querySelector('#segCable')?.addEventListener('click', () => {
    if (!isCable && !hasPn) {
      api.apply((m) => convertCircuitToCable(m, ref.idx));
      api.selectLink({ col: 'cables', idx: (api.model().cables ?? []).length - 1 });
    }
  });
  bindFields(panel, api, l as unknown as Record<string, unknown>);
  panel.querySelectorAll<HTMLInputElement>('input[data-pep]').forEach((inp) => {
    const side = inp.getAttribute('data-pep') as 'a' | 'b';
    inp.addEventListener('input', () =>
      api.mutate((m) => {
        const link = (m[ref.col] ?? [])[ref.idx];
        if (!link) return;
        if (inp.value) link[side].interface = inp.value;
        else delete link[side].interface;
      }),
    );
    inp.addEventListener('change', () => api.commit());
  });
  panel
    .querySelector('[data-act="dellink"]')
    ?.addEventListener('click', () => api.deleteSelection());
}
