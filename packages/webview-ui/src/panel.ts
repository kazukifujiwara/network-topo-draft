/**
 * Property panel, ported from v7 `renderPanel()` (minus templates and the
 * language toggle — plan §5). Field edits follow the v7 commit granularity:
 * 'input' events mutate the working model and re-render the canvas,
 * 'change' events (blur/Enter) commit — one undo step per field edit (D6).
 *
 * CSP note: markup contains no style attributes; dynamic colors are applied
 * via CSSOM after insertion.
 */
import type { Cable, Circuit, Device, LogicalLink, Network, ProviderNetwork, Topology } from '@topodraft/core';
import {
  allVrfs,
  deriveDeviceVrfs,
  findDevice,
  findNetwork,
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
import { T, fmt } from './strings';

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
    <button data-act="copy">${T('copy')}</button>
    <button data-act="dup">${T('dup')}</button>
    ${withDelete ? `<button data-act="del" class="danger">${T('del')}</button>` : ''}
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
    panel.innerHTML = `<div class="pn-title">${T('home_title')}</div>
      <div class="pn-info">${T('pn_paused')}</div>`;
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
    const network = findNetwork(t, name);
    if (network) return renderNetwork(panel, api, t, network);
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
  panel.innerHTML = `<div class="pn-title">${T('home_title')}</div>
    <div class="pn-info">${T('home_info')}</div>`;
}

/* ---------- multi selection ---------- */

function renderMulti(panel: HTMLElement, api: EditorApi, t: Topology, nodes: ReadonlySet<string>): void {
  panel.innerHTML = `
    ${datalists(t)}
    <div class="pn-title">${T('sel_title')} <span class="badge">${fmt(T('badge_nodes'), { n: nodes.size })}</span></div>
    <div class="fld"><label>${T('bulk_label')}</label>
      <input id="bulkSite" list="dlSites" placeholder="${T('bulk_ph')}" spellcheck="false"></div>
    <button class="mini-btn" id="bulkSiteApply">${T('bulk_apply')}</button>
    <div class="pn-sep"></div>
    <div class="pn-title">${T('arrange')}</div>
    <div class="align-row">
      <button data-arr="row" title="${T('tt_row')}">${T('al_row')}</button>
      <button data-arr="col" title="${T('tt_col')}">${T('al_col')}</button>
    </div>
    <div class="align-row">
      <button data-arr="dh" title="${T('tt_dh')}">${T('al_dh')}</button>
      <button data-arr="dv" title="${T('tt_dv')}">${T('al_dv')}</button>
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
    <div class="pn-title">${T('pn_title2')} <span class="badge">${T('pn_badge')}</span></div>
    ${fld('name', pn.name, 'e.g. Cloud Interconnect')}
    ${fld('provider', pn.provider, 'carrier / cloud provider')}
    ${fld('description', pn.description, '')}
    <div class="pn-sep"></div>
    <div class="pn-info">${T('pn_info')}</div>
    ${actionsRow()}`;
  bindRename(panel, api, pn.name);
  bindFields(panel, api, pn as unknown as Record<string, unknown>, { skip: ['name'] });
  bindActions(panel, api);
}

/* ---------- network segment (spec §3.10) ---------- */

function renderNetwork(panel: HTMLElement, api: EditorApi, t: Topology, n: Network): void {
  panel.innerHTML = `
    ${datalists(t)}
    <div class="pn-title">${T('net_title')} <span class="badge">${T('net_badge')}</span></div>
    ${fld('name', n.name, 'e.g. svc-seg-01')}
    <div class="fld-row">
      ${fld('prefix', n.prefix, '10.0.0.0/28')}
      ${fld('vlan', n.vlan, 'VLAN ID')}
    </div>
    <div class="pn-sep"></div>
    <div class="pn-title">${T('fhrp_title')}</div>
    <div class="fld-row">
      <div class="fld"><label>protocol</label>
        <input data-fh="protocol" value="${esc(n.fhrp?.protocol)}" placeholder="hsrp / vrrp / glbp" spellcheck="false"></div>
      <div class="fld"><label>group</label>
        <input data-fh="group" value="${esc(n.fhrp?.group)}" placeholder="1" spellcheck="false"></div>
    </div>
    <div class="fld"><label>virtual_ip</label>
      <input data-fh="virtual_ip" value="${esc(n.fhrp?.virtual_ip)}" placeholder="10.0.0.1/28" spellcheck="false"></div>
    <div class="pn-sep"></div>
    ${fld('description', n.description, '')}
    <div class="pn-info">${T('net_info')}</div>
    ${actionsRow()}`;
  bindRename(panel, api, n.name);
  bindFields(panel, api, n as unknown as Record<string, unknown>, { skip: ['name'] });
  panel.querySelectorAll<HTMLInputElement>('input[data-fh]').forEach((inp) => {
    const key = inp.getAttribute('data-fh') as 'protocol' | 'group' | 'virtual_ip';
    inp.addEventListener('input', () => {
      api.mutate((m) => {
        const net = findNetwork(m, n.name);
        if (!net) return;
        net.fhrp = net.fhrp ?? {};
        if (inp.value) net.fhrp[key] = inp.value;
        else delete net.fhrp[key];
        if (!Object.keys(net.fhrp).length) delete net.fhrp;
      });
    });
    inp.addEventListener('change', () => api.commit());
  });
  bindActions(panel, api);
}

/* ---------- device ---------- */

function renderDevice(panel: HTMLElement, api: EditorApi, t: Topology, d: Device): void {
  const explicit = new Set((d.vrfs ?? []).map((v) => v.trim()).filter(Boolean));
  const derivedVrfs = deriveDeviceVrfs(t, d.name);
  const vchips = derivedVrfs
    .map((v) => {
      const derived = !explicit.has(v);
      return `<span class="vchip${derived ? ' derived' : ''}" title="${derived ? T('vrf_chip_derived') : T('vrf_chip')}">
        <span class="vd" data-vrfdot="${esc(v)}"></span>${esc(v)}
        ${derived ? '' : `<button data-vdel="${esc(v)}" title="${T('vrf_chip_del')}">×</button>`}</span>`;
    })
    .join('');
  const ifs = (d.interfaces ?? [])
    .map(
      (f, i) => `
      <div class="if-card">
        <div class="if-row">
          <input data-if="${i}" data-k="name" value="${esc(f.name)}" placeholder="Gi0/0/1 or Gi0/0/1.100" spellcheck="false">
          <input data-if="${i}" data-k="ip_address" value="${esc(f.ip_address)}" placeholder="10.0.0.1/30" spellcheck="false">
          <button class="if-del" data-ifdel="${i}" title="${T('del')}">×</button>
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
    <div class="pn-title">${T('dev_title')} <span class="badge">${esc(iconKey(d.role))}</span></div>
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
    <div class="pn-title">${T('vrf_title')} <span class="badge">${derivedVrfs.length}</span></div>
    <div class="vchips">${vchips || `<span class="pn-dim">${T('vrf_none')}</span>`}</div>
    <div id="vrfAddRow">
      <input id="vrfNew" placeholder="${T('vrf_ph')}" list="dlVrfs" spellcheck="false">
      <button id="vrfAdd">${T('vrf_add')}</button>
    </div>
    <div class="pn-sep"></div>
    <div class="pn-title">${T('if_title')} <span class="badge">${(d.interfaces ?? []).length}</span></div>
    ${ifs || `<div class="pn-dim">${T('if_none')}</div>`}
    <button class="mini-btn" id="ifAdd">${T('if_add')}</button>
    <div class="pn-sep"></div>
    <div class="pn-title">${T('cc_title')} <span class="badge">${d.config_context ? Object.keys(d.config_context).length : '—'}</span></div>
    ${d.config_context ? `<div class="cc-preview" id="ccPreview" title="${T('cc_edit')}">${esc(ccPreview)}</div>` : ''}
    <button class="mini-btn" id="ccEdit">${T('cc_edit')}</button>
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
        <div class="ep-dev">${esc(ep.provider_network)} <span class="ep-site">${T('pn_title2')}${pn?.provider ? ' · ' + esc(pn.provider) : ''}</span></div>
        <div class="ep-lbl">${T('ep_id_pn')}</div>
        <input data-epid="${side}" value="${esc(ep.id)}" placeholder="e.g. vif-0001 / vc-42" spellcheck="false">
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
      <div class="ep-dev">${esc(ep.device ?? T('ep_unresolved'))} <span class="ep-site">${esc(dev ? siteOf(dev) || T('ep_no_site') : T('ep_missing'))}</span></div>
      ${vrfOpts}${ifOpts}
      <div class="ep-grid">
        <div><div class="ep-lbl">${T('ep_vrf')}</div>
          <input data-epv="${side}" list="dlv_${side}" value="${esc(ep.vrf)}" placeholder="global" spellcheck="false"></div>
        <div><div class="ep-lbl">${T('ep_id')}</div>
          <input data-epid="${side}" value="${esc(ep.id)}" placeholder="optional" spellcheck="false"></div>
      </div>
      <div class="ep-grid">
        <div><div class="ep-lbl">${T('ep_if')}</div>
          <input data-epi="${side}" list="dli_${side}" value="${esc(ifn)}" placeholder="Gi0/0/1.100" spellcheck="false"></div>
        <div><div class="ep-lbl">${T('ep_ip')}</div>
          <input data-epip="${side}" value="${esc(ip)}" placeholder="10.0.0.1/30" spellcheck="false"></div>
      </div>
    </div>`;
  };
  panel.innerHTML = `
    ${datalists(t)}
    <div class="pn-title">${T('log_title')} <span class="badge">${T('log_badge')}</span></div>
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
    <div class="pn-dim">${T('log_note')}</div>
    <div class="pn-actions"><button data-act="dellink" class="danger">${T('del_link')}</button></div>`;
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
      return `<div class="ep-box"><div class="ep-dev">${esc(ep.provider_network)} <span class="ep-site">${T('pn_title2')}${pn?.provider ? ' · ' + esc(pn.provider) : ''}</span></div></div>`;
    }
    const dev = ep.device !== undefined ? findDevice(t, ep.device) : undefined;
    const ifOpts = dev
      ? `<datalist id="dlpi_${side}">${(dev.interfaces ?? [])
          .map((f) => `<option value="${esc(f.name)}">`)
          .join('')}</datalist>`
      : '';
    return `<div class="ep-box">
      <div class="ep-dev">${esc(ep.device ?? T('ep_unresolved'))} <span class="ep-site">${esc(dev ? siteOf(dev) || T('ep_no_site') : T('ep_missing'))}</span></div>
      ${ifOpts}
      <input data-pep="${side}" list="dlpi_${side}" value="${esc(ep.interface)}" placeholder="interface (e.g. Gi0/0/1)" spellcheck="false">
    </div>`;
  };
  const common = isCable
    ? fld('type', (l as Cable).type, 'cat6 / smf / dac …') +
      `<div class="fld-row">${fld('bandwidth', (l as Cable).bandwidth, 'e.g. 10Gbps / 2x10G LAG')}${fld('status', (l as Cable).status, 'connected', 'dlStatus')}</div>` +
      fld('label', (l as Cable).label, '')
    : fld('cid', (l as Circuit).cid, 'circuit ID') +
      fld('provider', (l as Circuit).provider, 'carrier name') +
      `<div class="fld-row">${fld('type', (l as Circuit).type, 'leased line / IP-VPN …')}${fld('commit_rate', (l as Circuit).commit_rate, 'bandwidth, e.g. 1Gbps')}</div>` +
      fld('status', (l as Circuit).status, 'active / provisioning', 'dlStatus');
  panel.innerHTML = `
    ${datalists(t)}
    <div class="pn-title">${T('phy_title')} <span class="badge">${isCable ? T('badge_cable') : T('badge_circuit')}</span></div>
    <div class="seg">
      <button id="segCable" class="${isCable ? 'on' : ''}" ${hasPn ? `disabled title="${T('seg_pn_dis')}"` : ''}>cable</button>
      <button id="segCircuit" class="${isCable ? '' : 'on'}">circuit</button>
    </div>
    ${epBox('a')}
    <div class="ep-mid">▲▼</div>
    ${epBox('b')}
    <div class="pn-sep"></div>
    ${common}
    <div class="pn-actions"><button data-act="dellink" class="danger">${T('del_link')}</button></div>`;
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
