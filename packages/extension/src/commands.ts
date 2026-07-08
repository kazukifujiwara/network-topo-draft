/**
 * Command implementations (plan §4.4): exports, New Topology File, and
 * Save as Template. User templates are plain *.topo.json files inside the
 * folder configured by `topodraft.templatesFolder` (O2: file-based).
 */
import * as vscode from 'vscode';
import type { TemplateItem } from '@topodraft/protocol';
import { TopoParseError, parse, serialize } from '@topodraft/core';
import { activeTopoUri } from './activeDocument';
import { exportContent } from './exportContent';
import type { ExportKind } from './exportContent';
import { BUILTIN_TEMPLATES, templateText } from './templates';
import { log } from './log';
import { ensureTopoJsonPath, templatesFolderKind } from './uriUtils';
import { upsertAgentGuide, upsertNetboxGuide } from './agentGuide';

const t = vscode.l10n.t;

async function topoText(
  uri: vscode.Uri | undefined = activeTopoUri(),
): Promise<{ uri: vscode.Uri; text: string } | undefined> {
  if (!uri) {
    void vscode.window.showErrorMessage(
      t('Open a *.topo.json file first — this command works on the active topology document.'),
    );
    return undefined;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  return { uri, text: document.getText() };
}

function basenameNoExt(uri: vscode.Uri): string {
  return (uri.path.split('/').pop() ?? 'topology').replace(/\.topo(\.json)?$/, '');
}

/* ---------- exports ---------- */

/** Run an export against a specific document, or the active one (commands). */
export async function runExport(kind: ExportKind, uri?: vscode.Uri): Promise<void> {
  const active = await topoText(uri);
  if (!active) return;
  let result;
  try {
    result = exportContent(kind, active.text);
  } catch (e) {
    if (e instanceof TopoParseError) {
      void vscode.window.showErrorMessage(
        t('Cannot export: the document does not parse ({0})', e.message),
      );
      return;
    }
    throw e;
  }
  if (kind === 'drawio') {
    // a .drawio artifact is meant for diagrams.net — save it as a file
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(
        active.uri.with({ path: active.uri.path.replace(/[^/]+$/, '') }),
        result.suggestedName(basenameNoExt(active.uri)),
      ),
      filters: { 'draw.io diagram': ['drawio'] },
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(result.content));
    void vscode.window.showInformationMessage(
      t('Exported {0} — open it with diagrams.net / draw.io.', target.path.split('/').pop() ?? ''),
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument({
    language: result.language,
    content: result.content,
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}

/* ---------- templates folder (O2: file-based) ---------- */

function templatesFolderUri(): vscode.Uri | undefined {
  const configured = vscode.workspace
    .getConfiguration('topodraft')
    .get<string>('templatesFolder', '.topodraft/templates');
  switch (templatesFolderKind(configured)) {
    case 'uri':
      // full URIs make the setting usable on virtual workspaces
      // (vscode.dev / github.dev), where file paths cannot resolve (#3)
      try {
        return vscode.Uri.parse(configured, true);
      } catch {
        return undefined;
      }
    case 'absolute-path':
      return vscode.Uri.file(configured);
    case 'relative': {
      const root = vscode.workspace.workspaceFolders?.[0];
      return root ? vscode.Uri.joinPath(root.uri, configured) : undefined;
    }
  }
}

async function listUserTemplates(): Promise<{ label: string; uri: vscode.Uri }[]> {
  const folder = templatesFolderUri();
  if (!folder) return [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(folder);
    return entries
      .filter(
        ([name, type]) =>
          type === vscode.FileType.File && (name.endsWith('.topo.json') || name.endsWith('.topo')),
      )
      .map(([name]) => ({
        label: name.replace(/\.topo(\.json)?$/, ''),
        uri: vscode.Uri.joinPath(folder, name),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return []; // folder does not exist yet
  }
}

/* ---------- New Topology File ---------- */

interface TemplatePick extends vscode.QuickPickItem {
  key?: string;
}

/**
 * Templates offered by the ＋New menu and the command's QuickPick, in menu
 * order: built-ins first, then the user's templates folder. Keys round-trip
 * through NewFileRequestMessage.
 */
export async function listTemplateItems(): Promise<TemplateItem[]> {
  const builtinLabel: Record<string, string> = {
    empty: t('Empty topology'),
    'two-site-wan': t('2-site redundant WAN'),
    'site-cloud': t('Site + cloud (VRF logical)'),
    'hsrp-segment': t('Gateway pair + segment (HSRP)'),
    'lag-pair': t('Routed LAG pair'),
  };
  const builtinDescription: Record<string, string> = {
    empty: t('A blank canvas'),
    'two-site-wan': t('Two sites, redundant carrier circuits'),
    'site-cloud': t('HQ connected to a cloud peer over a dedicated interconnect, logical VRF link'),
    'hsrp-segment': t('Two gateways sharing a /28 multi-access segment with an HSRP virtual IP'),
    'lag-pair': t('Two routers uplinked to a switch pair over 2-member LAGs (lag interface examples)'),
  };
  const items: TemplateItem[] = BUILTIN_TEMPLATES.map((b) => ({
    key: `builtin:${b.id}`,
    label: builtinLabel[b.id] ?? b.label,
    description: builtinDescription[b.id] ?? b.description,
  }));
  for (const u of await listUserTemplates()) {
    items.push({ key: `user:${u.uri.toString()}`, label: u.label });
  }
  return items;
}

async function templateContent(key: string): Promise<string | undefined> {
  if (key.startsWith('builtin:')) {
    const builtin = BUILTIN_TEMPLATES.find((b) => b.id === key.slice('builtin:'.length));
    return builtin ? templateText(builtin) : undefined;
  }
  if (key.startsWith('user:')) {
    try {
      const uri = vscode.Uri.parse(key.slice('user:'.length), true);
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch (e) {
      log(`newFile: cannot read template ${key}: ${(e as Error).message}`);
      return undefined;
    }
  }
  return undefined;
}

async function newTopologyFile(templateKey?: string): Promise<void> {
  log(`newFile: invoked${templateKey ? ` template=${templateKey}` : ''}`);
  // The toolbar ＋New menu preselects a template; only the command-palette
  // path (no argument) goes through the QuickPick. A QuickPick triggered
  // from a webview message is dismissed by the webview re-taking focus
  // (microsoft/vscode#214787), so the webview never relies on it.
  let content = templateKey !== undefined ? await templateContent(templateKey) : undefined;
  if (content === undefined) {
    const items = await listTemplateItems();
    const picks: TemplatePick[] = [];
    for (const item of items) {
      if (item.key.startsWith('user:') && !picks.some((x) => x.kind !== undefined)) {
        picks.push({ label: t('Your templates'), kind: vscode.QuickPickItemKind.Separator });
      }
      picks.push({ label: item.label, description: item.description, key: item.key });
    }
    const pick = await vscode.window.showQuickPick(picks, {
      placeHolder: t('Pick a template for the new topology'),
      ignoreFocusOut: true,
    });
    if (!pick?.key) return;
    content = await templateContent(pick.key);
    if (content === undefined) return;
    templateKey = pick.key;
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const picked = await vscode.window.showSaveDialog({
    defaultUri: root ? vscode.Uri.joinPath(root, 'new.topo.json') : undefined,
    filters: { 'TopoDraft topology': ['topo.json', 'json', 'topo'] },
  });
  log(`newFile: template=${templateKey ?? '?'} dialog=${picked?.toString() ?? 'cancelled'}`);
  if (!picked) return;
  // native dialogs mishandle the compound ".topo.json" extension — normalize
  // instead of trusting the returned name (the editor/schema key off it)
  const target = picked.with({ path: ensureTopoJsonPath(picked.path) });
  if (target.path !== picked.path) log(`newFile: normalized to ${target.toString()}`);
  try {
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content));
    const stat = await vscode.workspace.fs.stat(target);
    log(`newFile: wrote ${stat.size} bytes to ${target.fsPath}`);
  } catch (e) {
    log(`newFile: WRITE FAILED: ${(e as Error).message}`);
    void vscode.window.showErrorMessage(
      t('Could not create {0}: {1}', target.fsPath, (e as Error).message),
    );
    return;
  }
  await vscode.commands.executeCommand('vscode.openWith', target, 'topodraft.editor');
  log('newFile: opened in topology editor');
}

/* ---------- Save as Template ---------- */

async function saveAsTemplate(): Promise<void> {
  const active = await topoText();
  if (!active) return;
  let normalized: string;
  try {
    normalized = serialize(parse(active.text));
  } catch (e) {
    void vscode.window.showErrorMessage(
      t('Cannot save as template: the document does not parse ({0})', (e as Error).message),
    );
    return;
  }
  const folder = templatesFolderUri();
  if (!folder) {
    void vscode.window.showErrorMessage(
      t('Open a workspace folder (or set an absolute topodraft.templatesFolder) to save templates.'),
    );
    return;
  }
  const name = await vscode.window.showInputBox({
    prompt: t('Template name'),
    value: basenameNoExt(active.uri),
    validateInput: (v) =>
      /^[^/\\:*?"<>|]+$/.test(v.trim()) && v.trim() ? undefined : t('Enter a valid file name.'),
  });
  if (!name) return;
  const target = vscode.Uri.joinPath(folder, `${name.trim()}.topo.json`);
  try {
    await vscode.workspace.fs.stat(target);
    const overwrite = await vscode.window.showWarningMessage(
      t('Template "{0}" already exists. Overwrite?', name.trim()),
      { modal: true },
      t('Overwrite'),
    );
    if (!overwrite) return;
  } catch {
    // does not exist — fine
  }
  await vscode.workspace.fs.createDirectory(folder);
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(normalized));
  void vscode.window.showInformationMessage(
    t('Saved template "{0}" to {1}.', name.trim(), vscode.workspace.asRelativePath(target)),
  );
}

/* ---------- AI agent guide (AGENTS.md) ---------- */

async function writeAgentGuide(saveAs = false, netbox = false): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root && !saveAs) {
    void vscode.window.showErrorMessage(
      t('Open a workspace folder first — the agent guide is written to its AGENTS.md.'),
    );
    return;
  }
  let target: vscode.Uri;
  if (saveAs) {
    const picked = await vscode.window.showSaveDialog({
      defaultUri: root ? vscode.Uri.joinPath(root, 'AGENTS.md') : undefined,
      filters: { Markdown: ['md'] },
    });
    if (!picked) return;
    target = picked;
  } else {
    target = vscode.Uri.joinPath(root as vscode.Uri, 'AGENTS.md');
  }
  let existing: string | null = null;
  try {
    existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
  } catch {
    // file does not exist yet
  }
  let content = upsertAgentGuide(existing);
  if (netbox) content = upsertNetboxGuide(content);
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content));
  log(
    `agentGuide: wrote ${target.fsPath}${existing !== null ? ' (updated existing file)' : ''}${netbox ? ' +netbox' : ''}`,
  );
  const shownName = target.path.split('/').pop() ?? 'AGENTS.md';
  void vscode.window.showInformationMessage(
    existing !== null
      ? t('Updated the TopoDraft section in {0}.', shownName)
      : t('Wrote the AI agent guide to {0} — coding agents pick it up automatically.', shownName),
  );
  await vscode.window.showTextDocument(target, { preview: true });
}

/** Opt-in: upsert ONLY the NetBox sync-notes section into AGENTS.md. */
async function writeNetboxGuide(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    void vscode.window.showErrorMessage(
      t('Open a workspace folder first — the agent guide is written to its AGENTS.md.'),
    );
    return;
  }
  const target = vscode.Uri.joinPath(root, 'AGENTS.md');
  let existing: string | null = null;
  try {
    existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
  } catch {
    // file does not exist yet
  }
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(upsertNetboxGuide(existing)));
  log(`netboxGuide: wrote ${target.fsPath}`);
  void vscode.window.showInformationMessage(
    t('Wrote the NetBox reference notes section to {0}.', target.path.split('/').pop() ?? 'AGENTS.md'),
  );
  await vscode.window.showTextDocument(target, { preview: true });
}

/**
 * Zero-setup first canvas (#4): opens a bundled example as an UNTITLED
 * document — no save dialog, no workspace folder required (works on
 * vscode.dev with nothing open), nothing written to disk unless the user
 * decides to save. Re-running focuses the same document instead of
 * duplicating it.
 */
async function openExample(): Promise<void> {
  // With a workspace open, anchor the untitled document to a path inside it:
  // on virtual workspaces (vscode.dev / github.dev) a bare relative untitled
  // name fails to resolve against the workspace scheme ("Unable to resolve
  // filesystem provider with relative file path"), and anchoring also gives
  // Save a sensible default location. Without a workspace the path must be
  // ABSOLUTE for the same reason: a bare relative name resolves against the
  // web default file system ('tmp:') and fails (#16) — the leading slash
  // keeps the untitled document purely virtual on desktop and web while
  // preserving the .topo.json name (editor/schema association, tab title).
  const root = vscode.workspace.workspaceFolders?.[0];
  const uri = root
    ? vscode.Uri.joinPath(root.uri, 'example.topo.json').with({ scheme: 'untitled' })
    : vscode.Uri.from({ scheme: 'untitled', path: '/example.topo.json' });
  const document = await vscode.workspace.openTextDocument(uri);
  if (document.getText().trim() === '') {
    const builtin = BUILTIN_TEMPLATES.find((b) => b.id === 'site-cloud');
    if (!builtin) return;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), templateText(builtin));
    await vscode.workspace.applyEdit(edit);
  }
  await vscode.commands.executeCommand('vscode.openWith', uri, 'topodraft.editor');
  log('openExample: opened the bundled example (untitled)');
}

export function registerCommands(): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('topodraft.exportMarkdown', () => runExport('markdown')),
    vscode.commands.registerCommand('topodraft.exportForAi', () => runExport('for-ai')),
    vscode.commands.registerCommand('topodraft.exportSchema', () => runExport('schema')),
    vscode.commands.registerCommand('topodraft.exportDrawio', () => runExport('drawio')),
    vscode.commands.registerCommand('topodraft.newFile', (template?: string) =>
      newTopologyFile(typeof template === 'string' ? template : undefined),
    ),
    vscode.commands.registerCommand('topodraft.saveAsTemplate', () => saveAsTemplate()),
    vscode.commands.registerCommand('topodraft.openExample', () => openExample()),
    vscode.commands.registerCommand('topodraft.writeAgentGuide', (saveAs?: boolean, netbox?: boolean) =>
      writeAgentGuide(saveAs === true, netbox === true),
    ),
    vscode.commands.registerCommand('topodraft.writeNetboxGuide', () => writeNetboxGuide()),
  );
}
