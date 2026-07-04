/**
 * Command implementations (plan §4.4): exports, New Topology File, and
 * Save as Template. User templates are plain *.topo.json files inside the
 * folder configured by `topodraft.templatesFolder` (O2: file-based).
 */
import * as vscode from 'vscode';
import { TopoParseError, parse, serialize } from '@topodraft/core';
import { activeTopoUri } from './activeDocument';
import { exportContent } from './exportContent';
import type { ExportKind } from './exportContent';
import { BUILTIN_TEMPLATES, templateText } from './templates';

const t = vscode.l10n.t;

async function activeTopoText(): Promise<{ uri: vscode.Uri; text: string } | undefined> {
  const uri = activeTopoUri();
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
  return (uri.path.split('/').pop() ?? 'topology').replace(/\.topo\.json$/, '');
}

/* ---------- exports ---------- */

async function runExport(kind: ExportKind): Promise<void> {
  const active = await activeTopoText();
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
  if (/^(\/|[a-zA-Z]:[\\/])/.test(configured)) return vscode.Uri.file(configured);
  const root = vscode.workspace.workspaceFolders?.[0];
  return root ? vscode.Uri.joinPath(root.uri, configured) : undefined;
}

async function listUserTemplates(): Promise<{ label: string; uri: vscode.Uri }[]> {
  const folder = templatesFolderUri();
  if (!folder) return [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(folder);
    return entries
      .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.topo.json'))
      .map(([name]) => ({
        label: name.replace(/\.topo\.json$/, ''),
        uri: vscode.Uri.joinPath(folder, name),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return []; // folder does not exist yet
  }
}

/* ---------- New Topology File ---------- */

interface TemplatePick extends vscode.QuickPickItem {
  builtinId?: string;
  userUri?: vscode.Uri;
}

async function newTopologyFile(): Promise<void> {
  const builtinLabel: Record<string, string> = {
    empty: t('Empty topology'),
    'two-site-wan': t('2-site redundant WAN'),
    'site-cloud-dx': t('Site + cloud (DX, VRF logical)'),
  };
  const builtinDescription: Record<string, string> = {
    empty: t('A blank canvas'),
    'two-site-wan': t('Two sites, redundant carrier circuits'),
    'site-cloud-dx': t('HQ with Direct Connect to a cloud peer, logical VRF link'),
  };
  const picks: TemplatePick[] = BUILTIN_TEMPLATES.map((b) => ({
    label: builtinLabel[b.id] ?? b.label,
    description: builtinDescription[b.id] ?? b.description,
    builtinId: b.id,
  }));
  const user = await listUserTemplates();
  if (user.length) {
    picks.push({ label: t('Your templates'), kind: vscode.QuickPickItemKind.Separator });
    picks.push(...user.map((u) => ({ label: u.label, userUri: u.uri })));
  }
  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: t('Pick a template for the new topology'),
  });
  if (!pick) return;
  let content: string;
  if (pick.builtinId !== undefined) {
    const builtin = BUILTIN_TEMPLATES.find((b) => b.id === pick.builtinId);
    if (!builtin) return;
    content = templateText(builtin);
  } else if (pick.userUri) {
    content = new TextDecoder().decode(await vscode.workspace.fs.readFile(pick.userUri));
  } else {
    return;
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const target = await vscode.window.showSaveDialog({
    defaultUri: root ? vscode.Uri.joinPath(root, 'new.topo.json') : undefined,
    filters: { 'Network TopoDraft topology': ['topo.json', 'json'] },
  });
  if (!target) return;
  if (!target.path.endsWith('.topo.json')) {
    void vscode.window.showWarningMessage(
      t('The file name should end with .topo.json so the topology editor and schema apply.'),
    );
  }
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content));
  await vscode.commands.executeCommand('vscode.openWith', target, 'topodraft.editor');
}

/* ---------- Save as Template ---------- */

async function saveAsTemplate(): Promise<void> {
  const active = await activeTopoText();
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

export function registerCommands(): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('topodraft.exportMarkdown', () => runExport('markdown')),
    vscode.commands.registerCommand('topodraft.exportForAi', () => runExport('for-ai')),
    vscode.commands.registerCommand('topodraft.exportSchema', () => runExport('schema')),
    vscode.commands.registerCommand('topodraft.exportDrawio', () => runExport('drawio')),
    vscode.commands.registerCommand('topodraft.newFile', () => newTopologyFile()),
    vscode.commands.registerCommand('topodraft.saveAsTemplate', () => saveAsTemplate()),
  );
}
