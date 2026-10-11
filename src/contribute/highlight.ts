import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openInEditor } from '../workspace.js';
import { printInfo, printWarning } from '../ui/display.js';
import type { IntentResult } from './intent.js';
import type { ContributionGuide } from './reader.js';

export async function writeBrief(
  repoPath: string,
  intent: IntentResult,
  guide: ContributionGuide,
  affectedFiles: string[],
  branchSuggestion: string,
  editorCommand: string,
): Promise<string> {
  const filesSection = affectedFiles.length > 0
    ? affectedFiles.map(file => `- \`${file}\``).join('\n')
    : '- Review files manually.';
  const prChecklist = guide.prTemplate || [
    guide.issueRequired ? '- [ ] Open or link an issue.' : '',
    guide.testCommand ? `- [ ] Run \`${guide.testCommand}\`.` : '- [ ] Run the test suite.',
    guide.signOffRequired ? '- [ ] Add a sign-off with `git commit -s`. A sign-off is an authorship statement.' : '',
    guide.hasCodeOfConduct ? '- [ ] Follow the Code of Conduct.' : '',
    guide.licenseAgreement ? `- [ ] Sign the ${guide.licenseAgreement}.` : '',
    '- [ ] Update documentation if needed.',
  ].filter(Boolean).join('\n');
  const content = `# Contribution Brief

Generated: ${new Date().toISOString()}
Repository: ${repoPath}

## Your Intent

${intent.raw}

## Critical Points

${intent.checklist}

## Files to Check

${filesSection}

## Suggested Branch

\`${branchSuggestion}\`

Use this branch as your separate work area.

## PR Checklist

A PR asks the project to review your changes.

${prChecklist}
`;
  const directory = path.join(os.homedir(), '.layman', 'briefs');
  const identity = crypto.createHash('sha256').update(`${path.resolve(repoPath)}\0${branchSuggestion}`).digest('hex').slice(0, 12);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const briefPath = path.join(directory, `${identity}-${Date.now()}-${crypto.randomUUID()}.md`);
  fs.writeFileSync(briefPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  printInfo(`Brief saved: ${briefPath}`);
  try {
    await openInEditor([briefPath], editorCommand);
  } catch (error) {
    printWarning(`Brief saved. Open it in your editor: ${briefPath}. ${(error as Error).message}`);
  }
  return briefPath;
}
