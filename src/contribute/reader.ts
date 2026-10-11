import { Octokit } from '@octokit/rest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  /** Evidence is data only. Commands from it are never run automatically. */
  sources?: PolicySource[];
  policyHash?: string;
  requirements?: PolicyRequirement[];
  templates?: PolicyTemplate[];
  commands?: PolicyCommand[];
}

export interface PolicySource {
  id: string;
  path: string;
  ref: string;
  excerpt: string;
  content: string;
  status: 'found' | 'missing' | 'unknown';
}

export interface PolicyRequirement {
  id: string;
  text: string;
  kind: 'required' | 'conditional' | 'advisory';
  status: 'satisfied' | 'unmet' | 'unknown' | 'not-applicable';
  sourceId: string;
  excerpt: string;
  action: 'issue' | 'check' | 'agreement' | 'approval' | 'security' | 'manual';
  command?: string;
}

export interface PolicyTemplate {
  path: string;
  content: string;
  kind: 'issue' | 'pr' | 'issue-form';
  ref?: string;
  status?: PolicySource['status'];
}

export interface PolicyCommand {
  command: string;
  kind: 'setup' | 'check';
  sourceId: string;
}

const LOCAL_PATHS = [
  '.github/CONTRIBUTING.md',
  'CONTRIBUTING.md',
  'CONTRIBUTING.rst',
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
  'PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
];

const ISSUE_TEMPLATE_DIR = '.github/ISSUE_TEMPLATE';

function sourceId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 12);
}

function makeSource(filePath: string, content: string | null, ref: string, status: PolicySource['status']): PolicySource {
  return {
    id: sourceId(filePath), path: filePath, ref, content: content ?? '',
    excerpt: (content ?? '').slice(0, 600), status,
  };
}

function policyHash(sources: PolicySource[], templates: PolicyTemplate[]): string {
  return createHash('sha256').update(JSON.stringify({
    sources: sources.map(source => [source.path, source.ref, source.status, source.content]),
    templates: templates.map(template => [template.path, template.ref ?? '', template.status ?? 'found', template.content]),
  })).digest('hex');
}

function readAtRef(repoPath: string, ref: string, filePath: string): string | null {
  try {
    return execFileSync('git', ['-C', repoPath, 'show', `${ref}:${filePath}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return null; }
}

function treePaths(repoPath: string, ref: string): string[] {
  try {
    return execFileSync('git', ['-C', repoPath, 'ls-tree', '-r', '-z', '--name-only', ref], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  } catch { return []; }
}

function readTemplates(repoPath: string, ref: string): PolicyTemplate[] {
  const templates: PolicyTemplate[] = [];
  for (const rel of PR_TEMPLATE_PATHS) {
    const content = readAtRef(repoPath, ref, rel);
    if (content !== null) templates.push({ path: rel, content, kind: 'pr', ref, status: 'found' });
  }
  for (const rel of treePaths(repoPath, ref)) {
    const isPR = rel.startsWith('.github/PULL_REQUEST_TEMPLATE/');
    const isIssue = rel.startsWith(`${ISSUE_TEMPLATE_DIR}/`);
    if ((!isPR && !isIssue) || !/\.(md|ya?ml)$/i.test(rel)) continue;
    if (isIssue && /\/config\.ya?ml$/i.test(rel)) continue;
    const content = readAtRef(repoPath, ref, rel);
    if (content !== null) templates.push({ path: rel, content, kind: isIssue && /\.ya?ml$/i.test(rel) ? 'issue-form' : isIssue ? 'issue' : 'pr', ref, status: 'found' });
  }
  return templates;
}
function extractReadmeSections(raw: string | null): string | null {
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
  ref: string,
): Promise<{ content: string; filePath: string } | { unknown: true } | null> {
  for (const dir of API_SCAN_DIRS) {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path: dir, ref });
      if (!Array.isArray(data)) continue;
      const match = data.find(
        f => f.type === 'file' &&
          /^(CONTRIBUTING|DEVELOPMENT|HACKING)/i.test(f.name) &&
          (f.name.endsWith('.md') || f.name.endsWith('.rst'))
      );
      if (match && match.type === 'file') {
        const { data: fd } = await octokit.repos.getContent({ owner, repo, path: match.path, ref });
        if (!Array.isArray(fd) && 'content' in fd) {
          return {
            content: Buffer.from(fd.content, 'base64').toString('utf-8'),
            filePath: match.path,
          };
        }
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 404) return { unknown: true };
    }
  }
  return null;
}

async function fetchPRTemplate(
  repoPath: string,
  ref: string,
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ templates: PolicyTemplate[]; unknown: boolean }> {
  const templates = readTemplates(repoPath, ref);
  if (templates.some(template => template.kind === 'pr')) return { templates, unknown: false };
  let unknown = false;
  for (const rel of PR_TEMPLATE_PATHS) {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path: rel, ref });
      if (!Array.isArray(data) && 'content' in data) {
        return { templates: [...templates, { path: rel, content: Buffer.from(data.content, 'base64').toString('utf-8'), kind: 'pr', ref, status: 'found' }], unknown };
      }
    } catch (error) { if ((error as { status?: number }).status !== 404) unknown = true; }
  }

  return { templates, unknown };
}

async function fetchAccountDefaults(
  octokit: Octokit,
  owner: string,
  repoPath: string,
  ref: string,
  templates: PolicyTemplate[],
): Promise<{ sources: PolicySource[]; templates: PolicyTemplate[]; unknown: boolean }> {
  let unknown = false;
  try {
    const { data } = await octokit.repos.get({ owner, repo: '.github' });
    if (data.private !== false) return { sources: [], templates, unknown: data.private !== true };
  } catch (error) {
    return { sources: [], templates, unknown: (error as { status?: number }).status !== 404 };
  }
  const accountRef = `api:${owner}/.github`;
  const sources: PolicySource[] = [];
  const hasRepo = (filePath: string) => readAtRef(repoPath, ref, filePath) !== null;
  const readDefault = async (paths: string[]): Promise<PolicySource | null> => {
    for (const filePath of paths) {
      try {
        const { data } = await octokit.repos.getContent({ owner, repo: '.github', path: filePath });
        if (!Array.isArray(data) && 'content' in data) return makeSource(`github:${owner}/.github/${filePath}`, Buffer.from(data.content, 'base64').toString('utf-8'), accountRef, 'found');
        unknown = true;
        return null;
      } catch (error) {
        if ((error as { status?: number }).status !== 404) { unknown = true; return null; }
      }
    }
    return null;
  };
  for (const filePath of ['CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md']) {
    if (hasRepo(filePath) || hasRepo(`.github/${filePath}`) || hasRepo(`docs/${filePath}`)) continue;
    const source = await readDefault([`.github/${filePath}`, filePath, `docs/${filePath}`]);
    if (source) sources.push(source);
  }
  if (!templates.some(template => template.kind === 'pr')) {
    const source = await readDefault(PR_TEMPLATE_PATHS);
    if (source) templates.push({ path: source.path, content: source.content, kind: 'pr', ref: accountRef, status: 'found' });
  }
  const hasIssueOverride = templates.some(template => template.kind === 'issue' || template.kind === 'issue-form') || hasRepo(`${ISSUE_TEMPLATE_DIR}/config.yml`);
  if (!hasIssueOverride) {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo: '.github', path: ISSUE_TEMPLATE_DIR });
      if (Array.isArray(data)) for (const file of data) {
        if (file.type !== 'file' || !/\.(md|ya?ml)$/i.test(file.name)) continue;
        const { data: body } = await octokit.repos.getContent({ owner, repo: '.github', path: file.path });
        if (!Array.isArray(body) && 'content' in body) {
          const source = makeSource(`github:${owner}/.github/${file.path}`, Buffer.from(body.content, 'base64').toString('utf-8'), accountRef, 'found');
          if (/^config\.ya?ml$/i.test(file.name)) sources.push(source);
          else templates.push({ path: source.path, content: source.content, kind: /\.ya?ml$/i.test(file.name) ? 'issue-form' : 'issue', ref: accountRef, status: 'found' });
        }
      }
    } catch (error) { if ((error as { status?: number }).status !== 404) unknown = true; }
  }
  return { sources, templates, unknown };
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

function addEvidence(
  guide: ContributionGuide,
  repoPath: string,
  ref: string,
  templates: PolicyTemplate[],
  apiUnknown = false,
  verified = true,
  extraSources: PolicySource[] = [],
): ContributionGuide {
  const policyPaths = [
    '.github/CONTRIBUTING.md', 'CONTRIBUTING.md', 'docs/CONTRIBUTING.md',
    '.github/DEVELOPMENT.md', 'DEVELOPMENT.md', 'docs/DEVELOPMENT.md',
    '.github/SECURITY.md', 'SECURITY.md', 'docs/SECURITY.md',
    '.github/CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT.md', 'docs/CODE_OF_CONDUCT.md',
    '.github/ISSUE_TEMPLATE/config.yml',
  ];
  const sources = policyPaths.map(filePath => {
    const content = readAtRef(repoPath, ref, filePath);
    return makeSource(filePath, content, ref, content === null ? (!verified || (apiUnknown && filePath === '.github/CONTRIBUTING.md') ? 'unknown' : 'missing') : 'found');
  });
  sources.push(...extraSources.filter(extra => !sources.some(source => source.path === extra.path)));
  if (apiUnknown) sources.push(makeSource('github:policy-discovery', null, `api:${ref}`, 'unknown'));
  const packageJson = readAtRef(repoPath, ref, 'package.json');
  if (packageJson) sources.push(makeSource('package.json', packageJson, ref, 'found'));
  if (guide.sourcePath && !sources.some(source => source.path === guide.sourcePath)) {
    const content = readAtRef(repoPath, ref, guide.sourcePath);
    sources.push(makeSource(guide.sourcePath, content, ref, content === null ? 'unknown' : 'found'));
  }
  for (const template of templates) {
    if (!sources.some(source => source.path === template.path)) {
      const external = template.path.startsWith('github:');
      const content = external ? template.content : readAtRef(repoPath, ref, template.path);
      sources.push(makeSource(template.path, content, template.ref ?? ref, content === null ? 'unknown' : (template.status ?? 'found')));
    }
  }
  const unknownRequirements: PolicyRequirement[] = sources.filter(source => source.status === 'unknown').map(source => ({
    id: `review-${source.id}`, text: `Review unread policy source: ${source.path}.`, kind: 'conditional', status: 'unknown',
    sourceId: source.id, excerpt: `Source was unavailable at ${source.ref}.`, action: 'manual',
  }));
  return { ...guide, sources, templates, commands: [], requirements: unknownRequirements, policyHash: policyHash(sources, templates) };
}

export async function readContributionGuide(ctx: RepoContext, config: LaymanConfig): Promise<ContributionGuide> {
  const octokit = new Octokit({ auth: config.github_token, userAgent: 'project-layman' });
  const verified = Boolean(ctx.baseSha);
  const ref = ctx.baseSha ?? 'HEAD (unverified)';
  const templateResult = verified
    ? await fetchPRTemplate(ctx.repoPath, ref, octokit, ctx.upstreamOwner, ctx.upstreamRepo)
    : { templates: [] as PolicyTemplate[], unknown: true };
  const templates = templateResult.templates;
  const accountDefaults = verified
    ? await fetchAccountDefaults(octokit, ctx.upstreamOwner, ctx.repoPath, ref, templates)
    : { sources: [] as PolicySource[], templates, unknown: true };
  const prTemplate = templates.find(template => template.kind === 'pr')?.content ?? null;
  const evidence = (guide: ContributionGuide, apiUnknown = false) => addEvidence(
    guide, ctx.repoPath, ref, templates, apiUnknown || templateResult.unknown || accountDefaults.unknown, verified, accountDefaults.sources,
  );

  // Step 1a: fixed local paths
  for (const rel of LOCAL_PATHS) {
    const content = verified ? readAtRef(ctx.repoPath, ref, rel) : null;
    if (content !== null) {
      const source: ContributionSource = rel.toUpperCase().startsWith('CONTRIBUTING') ? 'CONTRIBUTING.md' : 'CONTRIBUTING_ALT';
      printInfo(`Read repository rules from ${rel}.`);
      return evidence(parseGuide(content, source, rel, prTemplate));
    }
  }

  // Step 1b: scan docs/ and doc/ for non-standard filenames
  const scanned = verified ? treePaths(ctx.repoPath, ref).find(rel => SCAN_DIRS.some(dir => rel.startsWith(`${dir}/`)) && SCAN_PATTERN.test(rel.split('/').pop() ?? '') && /\.(md|rst)$/i.test(rel)) : undefined;
  if (scanned) {
    const content = readAtRef(ctx.repoPath, ref, scanned);
    if (content !== null) {
      printInfo(`Read repository rules from ${scanned}.`);
      return evidence(parseGuide(content, 'CONTRIBUTING_ALT', scanned, prTemplate));
    }
  }

  // Step 2: GitHub API directory scan
  const apiResult = verified ? await fetchViaAPI(octokit, ctx.upstreamOwner, ctx.upstreamRepo, ref) : { unknown: true };
  if (apiResult && !('unknown' in apiResult)) {
      printInfo(`Read repository rules from GitHub: ${apiResult.filePath}.`);
    return evidence(parseGuide(apiResult.content, 'GITHUB_API', apiResult.filePath, prTemplate));
  }

  // Step 3: README section extraction
  const readme = verified ? README_NAMES.map(name => readAtRef(ctx.repoPath, ref, name)).find((content): content is string => content !== null) ?? null : null;
  const readmeSections = extractReadmeSections(readme);
  if (readmeSections) {
      printInfo('Read repository rules from README.');
    return evidence(parseGuide(readmeSections, 'README', 'README.md', prTemplate), Boolean(apiResult && 'unknown' in apiResult));
  }

  const inheritedContributing = accountDefaults.sources.find(source => source.path.endsWith('/CONTRIBUTING.md'));
  if (inheritedContributing) {
      printInfo('Read account contribution rules.');
    return evidence(parseGuide(inheritedContributing.content, 'GITHUB_API', inheritedContributing.path, prTemplate));
  }

  // Step 4: PR template only
  if (prTemplate) {
      printInfo('No contribution rules found. Use the PR template.');
    return evidence(parseGuide(prTemplate, 'PR_TEMPLATE', templates.find(template => template.kind === 'pr')?.path ?? null, prTemplate), Boolean(apiResult && 'unknown' in apiResult));
  }

  // Step 5: defaults
      printInfo('No contribution rules found. Review repository pages before publishing.');
  return evidence({
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
  }, Boolean(apiResult && 'unknown' in apiResult));
}
