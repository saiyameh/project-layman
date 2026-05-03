import { execa } from 'execa';
import { spawnSync } from 'node:child_process';

const EDITOR_MAP: Record<string, string> = {
  'code': 'VS Code',
  'cursor': 'Cursor',
  'zed': 'Zed',
  'webstorm': 'WebStorm',
  'idea': 'IntelliJ IDEA',
  'subl': 'Sublime Text',
  'vim': 'Vim',
  'nvim': 'Neovim',
};

const GUI_EDITORS = new Set(['code', 'cursor', 'zed', 'webstorm', 'idea', 'subl']);
const NEW_WINDOW_EDITORS = new Set(['code', 'cursor']);

export function detectInstalledEditors(): string[] {
  const found: string[] = [];
  for (const cmd of Object.keys(EDITOR_MAP)) {
    try {
      const { status } = spawnSync('which', [cmd], { stdio: 'pipe' });
      if (status === 0) {
        found.push(cmd);
      }
    } catch {
      // not found
    }
  }
  return found;
}

export async function openInEditor(paths: string[], editorCommand: string): Promise<void> {
  const args: string[] = [];

  if (NEW_WINDOW_EDITORS.has(editorCommand)) {
    args.push('--new-window');
  }

  args.push(...paths);

  const isTerminalEditor = !GUI_EDITORS.has(editorCommand);

  try {
    if (isTerminalEditor) {
      await execa(editorCommand, args, { stdio: 'inherit' });
    } else {
      await execa(editorCommand, args, { detached: true, stdio: 'ignore' });
    }
  } catch {
    throw new Error('UGH. EDITOR NOT FOUND. RUN layman --reset TO PICK NEW ONE.');
  }
}

export function getEditorDisplayName(cmd: string): string {
  return EDITOR_MAP[cmd] || cmd;
}
