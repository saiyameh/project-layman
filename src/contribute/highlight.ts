import fs from 'node:fs';
import path from 'node:path';
import { openInEditor } from '../workspace.js';
import { printInfo } from '../ui/display.js';
import type { IntentResult } from './intent.js';
import type { ContributionGuide } from './reader.js';

export async function writeBrief(
  repoPath: string,
  intent: IntentResult,
  guide: ContributionGuide,
  affectedFiles: string[],
  branchSuggestion: string,
  editorCommand: string,
): Promise<void> {
  const date = new Date().toISOString().split('T')[0];

  const filesSection = affectedFiles.length > 0
    ? affectedFiles.map(f => `- \`${f}\``).join('\n')
    : '- (dependency analysis unavailable — review manually)';

  const prChecklist = guide.prTemplate
    ? guide.prTemplate
    : [
        guide.issueRequired    ? '- [ ] Open or link an issue before submitting'        : '',
        guide.testCommand      ? `- [ ] Run \`${guide.testCommand}\` and ensure it passes` : '- [ ] Run the test suite and ensure it passes',
        guide.signOffRequired  ? '- [ ] Sign your commits with `git commit -s` (DCO)'  : '',
        guide.hasCodeOfConduct ? '- [ ] Follow the Code of Conduct'                    : '',
        guide.licenseAgreement ? `- [ ] Sign the ${guide.licenseAgreement}`            : '',
        '- [ ] Update documentation if applicable',
        '- [ ] Keep the PR focused — one concern per PR',
      ].filter(Boolean).join('\n');

  const content = `# Contribution Brief

Generated: ${date}
Repository: ${repoPath}

## Your Intent

${intent.raw}

## Critical Points

${intent.checklist}

## Files to Check

${filesSection}

## Suggested Branch

\`${branchSuggestion}\`

## PR Checklist

${prChecklist}
`;

  const briefPath = path.join(repoPath, 'LAYMAN_BRIEF.md');
  fs.writeFileSync(briefPath, content, 'utf-8');
  printInfo('UGH. WROTE LAYMAN_BRIEF.md.');

  // Append to .gitignore so it doesn't show in git status
  const gitignorePath = path.join(repoPath, '.gitignore');
  let gitignore = '';
  try { gitignore = fs.readFileSync(gitignorePath, 'utf-8'); } catch { /* create fresh */ }
  if (!gitignore.split('\n').some(l => l.trim() === 'LAYMAN_BRIEF.md')) {
    const separator = gitignore.length > 0 && !gitignore.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(gitignorePath, gitignore + separator + 'LAYMAN_BRIEF.md\n', 'utf-8');
    printInfo('UGH. ADDED BRIEF TO .GITIGNORE SO IT NOT BOTHER GIT.');
  }

  // Write VS Code workspace file if .vscode/ exists or VS Code is the editor
  const vscodePath = path.join(repoPath, '.vscode');
  if (fs.existsSync(vscodePath) || editorCommand === 'code' || editorCommand === 'cursor') {
    try {
      fs.mkdirSync(vscodePath, { recursive: true });
      const ws = {
        folders: [{ path: '.' }],
        settings: { 'explorer.fileNesting.enabled': true },
        layman: { affectedFiles },
      };
      fs.writeFileSync(
        path.join(vscodePath, 'layman.code-workspace'),
        JSON.stringify(ws, null, 2),
        'utf-8',
      );
    } catch { /* non-fatal */ }
  }

  // Open brief in editor
  try {
    await openInEditor([briefPath], editorCommand);
  } catch { /* non-fatal if editor fails */ }
}
