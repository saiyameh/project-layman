import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-brief-home-'));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-brief-repo-'));
const priorHomedir = os.homedir;
os.homedir = () => home;
after(() => {
  os.homedir = priorHomedir;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('writes a new private brief outside the contribution repository', async () => {
  const { writeBrief } = await import('../dist/contribute/highlight.js');
  const guide = { prTemplate: null, issueRequired: false, testCommand: null, signOffRequired: false, hasCodeOfConduct: false, licenseAgreement: null };
  const intent = { raw: 'Fix token refresh.', checklist: '- [ ] Reproduce issue', keywords: ['token'] };
  const first = await writeBrief(repo, intent, guide, ['src/token.ts'], 'fix/token', 'not-a-real-editor');
  const second = await writeBrief(repo, intent, guide, ['src/token.ts'], 'fix/token', 'not-a-real-editor');

  assert.notEqual(first, second);
  assert.equal(first.startsWith(path.join(home, '.layman', 'briefs')), true);
  assert.equal(fs.existsSync(path.join(repo, 'LAYMAN_BRIEF.md')), false);
  assert.equal(fs.existsSync(path.join(repo, '.gitignore')), false);
  assert.match(fs.readFileSync(first, 'utf8'), /Fix token refresh/);
  assert.equal(fs.statSync(first).mode & 0o777, 0o600);
});
