import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import simpleGit from 'simple-git';
import type { ContributionSession, CheckEvidence } from './state.js';

export const TOOL_FILE = /(^|\/)(LAYMAN_BRIEF\.md|layman\.code-workspace)$|^\.layman\//;
const SECRET_FILE = /(^|\/)(\.env(?:\..*)?|id_(?:rsa|ed25519)|credentials(?:\.json)?)$|\.(?:pem|key|p12|pfx)$/i;
const SECRET_CONTENT = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b/;
export interface ChangeSnapshot { files: string[]; diff: string; fingerprint: string; head: string }

export function assertSafeFiles(files: string[]): void {
  for (const file of files) {
    if (!file || file.startsWith('-') || path.isAbsolute(file) || file.split('/').includes('..') || file.includes('\0') || TOOL_FILE.test(file)) {
      throw new Error('The selected files contain a tool artifact or an invalid path. Select contribution files only.');
    }
    if (SECRET_FILE.test(file)) throw new Error(`${JSON.stringify(file)} can contain a secret. Remove it from the contribution.`);
  }
}

export async function listChangedFiles(repoPath: string, baseSha: string): Promise<string[]> {
  const git = simpleGit(repoPath);
  const tracked = (await git.raw(['diff', '--name-only', '--no-renames', '-z', baseSha, '--'])).split('\0').filter(Boolean);
  const untracked = (await git.raw(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  return [...new Set([...tracked, ...untracked])].filter(file => !TOOL_FILE.test(file)).sort();
}

export async function captureChanges(repoPath: string, baseSha: string, selection?: string[]): Promise<ChangeSnapshot> {
  const git = simpleGit(repoPath);
  if (!/^[a-f0-9]{40,64}$/i.test(baseSha)) throw new Error('The saved base revision is invalid. Prepare again.');
  const available = await listChangedFiles(repoPath, baseSha);
  const untracked = (await git.raw(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  const files = selection ? [...new Set(selection)].sort() : available;
  assertSafeFiles(files);
  if (files.some(file => !available.includes(file))) throw new Error('A selected file is no longer in the contribution diff. Check work again.');
  let diff = files.length ? await git.raw(['diff', '--no-ext-diff', '--no-textconv', '--binary', '--no-renames', baseSha, '--', ...files.map(file => `:(literal)${file}`)]) : '';
  for (const file of files.filter(item => untracked.includes(item))) {
    const full = path.join(repoPath, file);
    const stat = fs.lstatSync(full);
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('Unsupported file type. Review it with Git.');
    if (stat.size > 1024 * 1024) throw new Error(`${JSON.stringify(file)} is too large for automatic review. Split the contribution.`);
    const content = stat.isSymbolicLink() ? fs.readlinkSync(full) : fs.readFileSync(full, 'utf8');
    diff += `\nNew file: ${JSON.stringify(file)}\n${content}`;
  }
  if (diff.length > 1024 * 1024) throw new Error('This diff is too large for automatic review. Split the contribution.');
  if (SECRET_CONTENT.test(diff)) throw new Error('The diff contains a possible secret. Remove it before checks or model drafting.');
  const head = (await git.revparse(['HEAD'])).trim();
  const work = createHash('sha256').update(baseSha);
  for (const file of available) {
    work.update(JSON.stringify(file));
    const full = path.join(repoPath, file);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(full); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      work.update('deleted');
      continue;
    }
    if (stat.isSymbolicLink()) work.update('symlink').update(fs.readlinkSync(full));
    else if (stat.isFile()) work.update(stat.mode & 0o111 ? 'executable' : 'file').update(fs.readFileSync(full));
    else throw new Error('A changed submodule or special file needs manual Git review.');
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ baseSha, files, work: work.digest('hex') })).digest('hex');
  return { files, diff, fingerprint, head };
}

export function publicationBlockers(session: ContributionSession, fingerprint: string): string[] {
  const problems: string[] = [];
  for (const requirement of session.guide?.requirements ?? []) {
    if (requirement.kind === 'advisory' || requirement.status === 'not-applicable') continue;
    if (requirement.status === 'unmet') problems.push(requirement.text);
    if (requirement.action === 'issue' && requirement.kind === 'required' && !session.issueNumber) problems.push('Link a verified issue first.');
    if ((requirement.action === 'agreement' || requirement.action === 'approval') && requirement.status !== 'satisfied') problems.push(requirement.text);
    if (requirement.action === 'check' && requirement.command) {
      const latest = session.checks.filter(check => check.command === requirement.command && check.fingerprint === fingerprint).at(-1);
      if (latest && latest.result !== 'passed') problems.push(`Check failed: ${requirement.command}`);
      if (!latest && requirement.kind === 'required') problems.push(`Run the required check: ${requirement.command}`);
    }
    if (requirement.status === 'unknown' && !session.acknowledgments[requirement.id]) problems.push(`Review unknown requirement: ${requirement.text}`);
  }
  if (session.guide?.issueRequired && !session.issueNumber) problems.push('This repository requires an issue.');
  if (session.guide?.licenseAgreement && !session.acknowledgments['personal-agreement']) problems.push('Complete the required personal agreement.');
  for (const command of session.guide?.commands ?? []) {
    if (command.kind !== 'check') continue;
    const latest = session.checks.filter(check => check.command === command.command && check.fingerprint === fingerprint).at(-1);
    if (latest && latest.result !== 'passed') problems.push(`Check failed: ${command.command}`);
  }
  return [...new Set(problems)];
}

export async function runTrustedCommand(
  repoPath: string, command: string, fingerprint: string, kind: 'setup' | 'check', trusted: boolean,
  timeoutMs = 120000, secrets: string[] = [],
): Promise<CheckEvidence> {
  if (!trusted) throw new Error('This command has no execution approval.');
  if (!command.trim() || command.includes('\0')) throw new Error('This command is invalid.');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|API_KEY|AUTH|CREDENTIAL/i.test(key)));
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd: repoPath, shell: true, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    let interrupted = false;
    const stop = () => {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { /* process already stopped */ }
    };
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const hardStop = () => {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* process already stopped */ }
    };
    const interrupt = () => { interrupted = true; stop(); killTimer ??= setTimeout(hardStop, 1000); };
    const timer = setTimeout(() => { timedOut = true; stop(); killTimer = setTimeout(hardStop, 1000); }, timeoutMs);
    const collect = (data: Buffer) => { output = (output + data.toString()).slice(-64000); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    child.on('error', error => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); reject(new Error(`The command could not start (${error.name}).`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      for (const secret of secrets.filter(Boolean)) output = output.split(secret).join('[hidden]');
      output = output.replace(/\b(?:ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g, '[hidden]');
      resolve({ command, kind, fingerprint, time: new Date().toISOString(), result: interrupted ? 'interrupted' : timedOut ? 'timeout' : code === 0 ? 'passed' : 'failed', exitCode: code, output });
    });
  });
}
