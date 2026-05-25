import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execa } from 'execa';
import { printInfo, printWarning } from '../ui/display.js';
import type { RepoContext } from './preflight.js';

export interface DepGraph {
  language: string;
  tool: string;
  nodes: string[];
  edges: Map<string, string[]>;
  circular: string[][];
}

interface CachedGraph {
  language: string;
  tool: string;
  nodes: string[];
  edges: [string, string[]][];
  circular: string[][];
}

const DEPS_CACHE_DIR = path.join(os.homedir(), '.layman', 'deps-cache');
const CACHE_TTL_MS = 60 * 60 * 1000;

function getCacheKey(repoPath: string): string {
  const indicators = ['package.json', 'go.mod', 'Cargo.toml', 'requirements.txt'];
  let seed = repoPath;
  for (const f of indicators) {
    try { seed += fs.statSync(path.join(repoPath, f)).mtimeMs; } catch { /* absent */ }
  }
  return crypto.createHash('sha256').update(seed).digest('hex');
}

function readCache(key: string): DepGraph[] | null {
  const file = path.join(DEPS_CACHE_DIR, `${key}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    const { timestamp, data } = JSON.parse(fs.readFileSync(file, 'utf-8')) as { timestamp: number; data: CachedGraph[] };
    if (Date.now() - timestamp > CACHE_TTL_MS) return null;
    return data.map(g => ({ ...g, edges: new Map(g.edges) }));
  } catch { return null; }
}

function writeCache(key: string, graphs: DepGraph[]): void {
  try {
    fs.mkdirSync(DEPS_CACHE_DIR, { recursive: true });
    const data = graphs.map(g => ({ ...g, edges: [...g.edges.entries()] }));
    fs.writeFileSync(path.join(DEPS_CACHE_DIR, `${key}.json`), JSON.stringify({ timestamp: Date.now(), data }));
  } catch { /* non-fatal */ }
}

// --- language-specific builders ---

async function buildJSGraph(repoPath: string): Promise<DepGraph> {
  try {
    const srcDir = fs.existsSync(path.join(repoPath, 'src')) ? 'src' : '.';
    const { stdout } = await execa('npx', ['--yes', 'madge', srcDir, '--json'], {
      cwd: repoPath,
      timeout: 60000,
    });
    const raw = JSON.parse(stdout) as Record<string, string[]>;
    return {
      language: 'js',
      tool: 'madge',
      nodes: Object.keys(raw),
      edges: new Map(Object.entries(raw)),
      circular: [],
    };
  } catch {
    printWarning('UGH. MADGE NOT WORK. USING CAVE GREP INSTEAD.');
    return grepFallback(repoPath, 'js');
  }
}

async function buildPythonGraph(repoPath: string): Promise<DepGraph> {
  try {
    const { stdout } = await execa(
      'python', ['-m', 'pydeps', '.', '--noshow', '--show-deps', '--no-output'],
      { cwd: repoPath, timeout: 60000 },
    );
    const edges = new Map<string, string[]>();
    const nodes = new Set<string>();
    for (const line of stdout.split('\n').filter(Boolean)) {
      const parts = line.split('->').map(s => s.trim());
      if (parts[0]) {
        nodes.add(parts[0]);
        edges.set(parts[0], parts.slice(1).filter(Boolean));
      }
    }
    return { language: 'python', tool: 'pydeps', nodes: [...nodes], edges, circular: [] };
  } catch {
    printWarning('UGH. PYDEPS NOT FOUND. USING CAVE GREP INSTEAD.');
    return grepFallback(repoPath, 'python');
  }
}

async function buildGoGraph(repoPath: string): Promise<DepGraph> {
  try {
    const { stdout } = await execa('go', ['list', '-json', './...'], { cwd: repoPath, timeout: 60000 });
    // go list emits multiple JSON objects separated by newlines
    const chunks = stdout.split(/\n(?=\{)/).filter(Boolean);
    const edges = new Map<string, string[]>();
    const nodes: string[] = [];
    for (const chunk of chunks) {
      try {
        const pkg = JSON.parse(chunk) as { ImportPath: string; Imports?: string[] };
        nodes.push(pkg.ImportPath);
        edges.set(pkg.ImportPath, pkg.Imports ?? []);
      } catch { /* skip malformed */ }
    }
    return { language: 'go', tool: 'go list', nodes, edges, circular: [] };
  } catch {
    printWarning('UGH. GO LIST NOT WORK. USING CAVE GREP INSTEAD.');
    return grepFallback(repoPath, 'go');
  }
}

async function buildRustGraph(repoPath: string): Promise<DepGraph> {
  try {
    const { stdout } = await execa('cargo', ['tree', '--prefix', 'none'], { cwd: repoPath, timeout: 60000 });
    const nodes = stdout.split('\n')
      .filter(Boolean)
      .map(l => l.trim().split(' ')[0])
      .filter(Boolean);
    return { language: 'rust', tool: 'cargo tree', nodes, edges: new Map(), circular: [] };
  } catch {
    printWarning('UGH. CARGO TREE NOT WORK. USING CAVE GREP INSTEAD.');
    return grepFallback(repoPath, 'rust');
  }
}

async function grepFallback(repoPath: string, lang: string): Promise<DepGraph> {
  const extMap: Record<string, string[]> = {
    js: ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts'],
    python: ['py'],
    go: ['go'],
    rust: ['rs'],
    unknown: ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs'],
  };
  const exts = extMap[lang] ?? extMap['unknown'];
  const IMPORT_RES = [
    /import\s+.*?from\s+['"](\.[^'"]+)['"]/g,
    /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /^import\s+['"](\.[^'"]+)['"]/gm,
  ];

  const nodes: string[] = [];
  const edges = new Map<string, string[]>();
  const SKIP = new Set(['node_modules', 'vendor', '.git', 'dist', 'build', '__pycache__']);

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const ext = entry.name.split('.').pop() ?? '';
      if (!exts.includes(ext)) continue;
      const rel = path.relative(repoPath, full);
      nodes.push(rel);
      try {
        const content = fs.readFileSync(full, 'utf-8');
        const imports: string[] = [];
        for (const re of IMPORT_RES) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(content)) !== null) imports.push(m[1]);
        }
        if (imports.length) edges.set(rel, imports);
      } catch { /* unreadable */ }
    }
  }

  walk(repoPath);
  return { language: lang, tool: 'grep', nodes, edges, circular: [] };
}

// --- public API ---

export async function buildDependencyGraph(ctx: RepoContext): Promise<DepGraph[]> {
  const cacheKey = getCacheKey(ctx.repoPath);
  const cached = readCache(cacheKey);
  if (cached) {
    printInfo('UGH. USING CACHED CAVE MAP.');
    return cached;
  }

  const graphs: DepGraph[] = [];
  for (const lang of ctx.language) {
    printInfo(`UGH. MAPPING ${lang.toUpperCase()} CAVE...`);
    switch (lang) {
      case 'js':      graphs.push(await buildJSGraph(ctx.repoPath));     break;
      case 'python':  graphs.push(await buildPythonGraph(ctx.repoPath)); break;
      case 'go':      graphs.push(await buildGoGraph(ctx.repoPath));     break;
      case 'rust':    graphs.push(await buildRustGraph(ctx.repoPath));   break;
      default:        graphs.push(await grepFallback(ctx.repoPath, lang)); break;
    }
  }

  writeCache(cacheKey, graphs);
  return graphs;
}

export function findAffectedFiles(graphs: DepGraph[], keywords: string[]): string[] {
  const scores = new Map<string, number>();

  for (const graph of graphs) {
    for (const node of graph.nodes) {
      const lower = node.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score++;
      }
      if (score > 0) scores.set(node, (scores.get(node) ?? 0) + score);

      // Also score files that import a matched node
      for (const [from, deps] of graph.edges) {
        const nodeBase = node.replace(/\.[^.]+$/, '');
        if (deps.some(d => d.includes(nodeBase) || nodeBase.endsWith(d.replace(/^\.\//, '')))) {
          scores.set(from, (scores.get(from) ?? 0) + 0.5);
        }
      }
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file]) => file);
}
