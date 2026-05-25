import fs from 'node:fs';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import type { RepoContext } from './preflight.js';
import type { LaymanConfig } from '../config.js';
import { printInfo } from '../ui/display.js';

export type ContributionSource =
  | 'CONTRIBUTING.md'
  | 'CONTRIBUTING_ALT'
  | 'GITHUB_API'
  | 'README'
  | 'PR_TEMPLATE'
  | 'defaults';

export interface ContributionGuide {
  raw: string;
  hasCodeOfConduct: boolean;
  setupSteps: string[];
  testCommand: string | null;
  branchConvention: string | null;
  prTemplate: string | null;
  prTargetBranch: string | null;
  requiredChecks: string[];
  issueRequired: boolean;
  signOffRequired: boolean;
  licenseAgreement: string | null;
  source: ContributionSource;
  sourcePath: string | null;
}

const LOCAL_PATHS = [
  'CONTRIBUTING.md',
  'CONTRIBUTING.rst',
  '.github/CONTRIBUTING.md',
  'docs/CONTRIBUTING.md',
  'docs/contributing.md',
  'doc/CONTRIBUTING.md',
  'doc/contributing.md',
  'DEVELOPMENT.md',
  'development.md',
  'docs/DEVELOPMENT.md',
  'docs/development.md',
  'doc/DEVELOPMENT.md',
  'doc/development.md',
  'HACKING.md',
  'hacking.md',
  'docs/HACKING.md',
  'doc/HACKING.md',
];

const SCAN_DIRS = ['docs', 'doc'];
const SCAN_PATTERN = /^(contribut|develop|hack|guideline)/i;
const API_SCAN_DIRS = ['', '.github', 'docs', 'doc'];

const README_HEADING_RE = /^(#+)\s*(contribut|how to contribut|development|getting started|hacking|building|local setup|dev setup)/im;
const README_NAMES = ['README.md', 'readme.md', 'README.rst', 'README'];

const PR_TEMPLATE_PATHS = [
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/pull_request_template.md',
];

function readLocal(repoPath: string, rel: string): string | null {
  try {
    const full = path.join(repoPath, rel);
    if (fs.existsSync(full)) return fs.readFileSync(full, 'utf-8');
  } catch { /* ignore */ }
  return null;
}

function scanDir(repoPath: string, dir: string): { content: string; relPath: string } | null {
  const dirPath = path.join(repoPath, dir);
  if (!fs.existsSync(dirPath)) return null;
  try {
    const files = fs.readdirSync(dirPath);
    const match = files.find(f => SCAN_PATTERN.test(f) && (f.endsWith('.md') || f.endsWith('.rst')));
    if (match) {
      return {
        content: fs.readFileSync(path.join(dirPath, match), 'utf-8'),
        relPath: `${dir}/${match}`,
      };
    }
  } catch { /* ignore */ }
  return null;
}

function extractReadmeSections(repoPath: string): string | null {
  let raw: string | null = null;
  for (const name of README_NAMES) {
    raw = readLocal(repoPath, name);
    if (raw) break;
  }
  if (!raw) return null;

  const lines = raw.split('\n');
  const sections: string[] = [];
  let capturing = false;
  let captureLevel = 0;
  let buffer: string[] = [];

  for (const line of lines) {
    const hm = line.match(/^(#+)\s+(.+)/);
    if (hm) {
      const level = hm[1].length;
      const title = hm[2];
      if (README_HEADING_RE.test('#'.repeat(level) + ' ' + title)) {
        if (buffer.length) sections.push(buffer.join('\n'));
        buffer = [line];
        capturing = true;
        captureLevel = level;
      } else if (capturing && level <= captureLevel) {
        sections.push(buffer.join('\n'));
        buffer = [];
        capturing = false;
      } else if (capturing) {
        buffer.push(line);
      }
    } else if (capturing) {
      buffer.push(line);
    }
  }
  if (buffer.length && capturing) sections.push(buffer.join('\n'));

  return sections.length > 0 ? sections.join('\n\n---\n\n') : null;
}

async function fetchViaAPI(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ content: string; filePath: string } | null> {
  for (const dir of API_SCAN_DIRS) {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path: dir });
      if (!Array.isArray(data)) continue;
      const match = data.find(
        f => f.type === 'file' &&
          /^(CONTRIBUTING|DEVELOPMENT|HACKING)/i.test(f.name) &&
          (f.name.endsWith('.md') || f.name.endsWith('.rst'))
      );
      if (match && match.type === 'file') {
        const { data: fd } = await octokit.repos.getContent({ owner, repo, path: match.path });
        if (!Array.isArray(fd) && 'content' in fd) {
          return {
            content: Buffer.from(fd.content, 'base64').toString('utf-8'),
            filePath: match.path,
          };
        }
      }
    } catch { /* dir may not exist */ }
  }
  return null;
}

async function fetchPRTemplate(
  repoPath: string,
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string | null> {
  for (const rel of PR_TEMPLATE_PATHS) {
    const c = readLocal(repoPath, rel);
    if (c) return c;
  }

  const templateDir = path.join(repoPath, '.github', 'PULL_REQUEST_TEMPLATE');
  if (fs.existsSync(templateDir)) {
    try {
      const files = fs.readdirSync(templateDir).filter(f => f.endsWith('.md'));
      if (files[0]) return fs.readFileSync(path.join(templateDir, files[0]), 'utf-8');
    } catch { /* ignore */ }
  }

  for (const rel of PR_TEMPLATE_PATHS) {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path: rel });
      if (!Array.isArray(data) && 'content' in data) {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }
    } catch { /* ignore */ }
  }

  return null;
}

function parseGuide(
  raw: string,
  source: ContributionSource,
  sourcePath: string | null,
  prTemplate: string | null,
): ContributionGuide {
  const lower = raw.toLowerCase();

  const testMatch = raw.match(/`(npm test|yarn test|pnpm test|go test[^`]*|cargo test[^`]*|pytest[^`]*|python -m pytest[^`]*|make test)[^`]*`/i);

  const branchMatch = raw.match(/branch.*?[`'"]([\w/{}[\]*-]+)[`'"]/i);

  const setupSteps: string[] = [];
  const blocks = raw.match(/```[\s\S]*?```/g) ?? [];
  for (const block of blocks.slice(0, 4)) {
    const lines = block.replace(/^```\w*\n?/, '').replace(/```$/, '').trim().split('\n');
    setupSteps.push(...lines.filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('//')));
  }

  const checksMatch = raw.match(/(?:run|pass|must pass|ensure)[^.]*?(tests?|lint|type.?check|ci|checks?)[^.]*/gi) ?? [];

  const prBranchMatch =
    raw.match(/(?:submit|send|open|create|base).*?(?:pr|pull request).*?(?:to|against|into|on)\s+[`'"]([\w/-]+)[`'"]/i) ??
    raw.match(/(?:pr|pull request).*?(?:to|against|into|base on|targeting)\s+[`'"]([\w/-]+)[`'"]/i) ??
    raw.match(/(?:target|base)\s+branch[^.]*?[`'"]([\w/-]+)[`'"]/i);

  return {
    raw,
    hasCodeOfConduct: /code.of.conduct/i.test(lower),
    setupSteps: setupSteps.slice(0, 10),
    testCommand: testMatch ? testMatch[1] : null,
    branchConvention: branchMatch ? branchMatch[1] : null,
    prTemplate,
    prTargetBranch: prBranchMatch ? prBranchMatch[1] : null,
    requiredChecks: checksMatch.slice(0, 5).map(s => s.trim()),
    issueRequired: /open.*issue|create.*issue|file.*issue|issue.*first|issue.*required/i.test(lower),
    signOffRequired: /signed.off.by|dco|developer certificate/i.test(lower),
    licenseAgreement: /CLA|contributor license agreement/i.test(raw) ? 'CLA required' : null,
    source,
    sourcePath,
  };
}

export async function readContributionGuide(ctx: RepoContext, config: LaymanConfig): Promise<ContributionGuide> {
  const octokit = new Octokit({ auth: config.github_token, userAgent: 'project-layman' });
  const prTemplate = await fetchPRTemplate(ctx.repoPath, octokit, ctx.upstreamOwner, ctx.upstreamRepo);

  // Step 1a: fixed local paths
  for (const rel of LOCAL_PATHS) {
    const content = readLocal(ctx.repoPath, rel);
    if (content) {
      const source: ContributionSource = rel.toUpperCase().startsWith('CONTRIBUTING') ? 'CONTRIBUTING.md' : 'CONTRIBUTING_ALT';
      printInfo(`UGH. FOUND RULES IN ${rel}.`);
      return parseGuide(content, source, rel, prTemplate);
    }
  }

  // Step 1b: scan docs/ and doc/ for non-standard filenames
  for (const dir of SCAN_DIRS) {
    const result = scanDir(ctx.repoPath, dir);
    if (result) {
      printInfo(`UGH. FOUND RULES IN ${result.relPath}.`);
      return parseGuide(result.content, 'CONTRIBUTING_ALT', result.relPath, prTemplate);
    }
  }

  // Step 2: GitHub API directory scan
  const apiResult = await fetchViaAPI(octokit, ctx.upstreamOwner, ctx.upstreamRepo);
  if (apiResult) {
    printInfo(`UGH. FOUND RULES IN ${apiResult.filePath} (FROM GITHUB).`);
    return parseGuide(apiResult.content, 'GITHUB_API', apiResult.filePath, prTemplate);
  }

  // Step 3: README section extraction
  const readmeSections = extractReadmeSections(ctx.repoPath);
  if (readmeSections) {
    printInfo('UGH. FOUND RULES IN README.');
    return parseGuide(readmeSections, 'README', 'README.md', prTemplate);
  }

  // Step 4: PR template only
  if (prTemplate) {
    printInfo('UGH. NO RULES FOUND. USING PR TEMPLATE ONLY.');
    return parseGuide(prTemplate, 'PR_TEMPLATE', '.github/PULL_REQUEST_TEMPLATE.md', prTemplate);
  }

  // Step 5: defaults
  printInfo('UGH. NO RULES FOUND. WILL USE COMMON SENSE.');
  return {
    raw: '',
    hasCodeOfConduct: false,
    setupSteps: [],
    testCommand: null,
    branchConvention: null,
    prTemplate: null,
    prTargetBranch: null,
    requiredChecks: [],
    issueRequired: false,
    signOffRequired: false,
    licenseAgreement: null,
    source: 'defaults',
    sourcePath: null,
  };
}
