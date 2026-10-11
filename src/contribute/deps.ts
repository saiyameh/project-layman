import path from 'node:path';
import fs from 'node:fs';
import { printInfo } from '../ui/display.js';
import type { RepoContext } from './preflight.js';

export interface DepGraph {
  language: string;
  tool: string;
  nodes: string[];
  edges: Map<string, string[]>;
  circular: string[][];
}

const EXTENSIONS: Record<string, string[]> = {
  js: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'],
  python: ['.py'],
  go: ['.go'],
  rust: ['.rs'],
  unknown: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.py', '.go', '.rs'],
};
const SKIP = new Set(['node_modules', 'vendor', '.git', 'dist', 'build', 'target', '__pycache__']);

function relative(repoPath: string, file: string): string {
  return path.relative(repoPath, file).split(path.sep).join('/');
}

function sourceFiles(repoPath: string, extensions: string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (extensions.includes(path.extname(entry.name))) files.push(relative(repoPath, file));
    }
  };
  walk(repoPath);
  return files.sort();
}

function resolveImport(from: string, specifier: string, files: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  const extensions = Object.values(EXTENSIONS).flat();
  const candidates = [base, ...extensions.map(ext => `${base}${ext}`), ...extensions.map(ext => `${base}/index${ext}`)];
  return candidates.find(candidate => files.has(candidate)) ?? null;
}

function resolveGoImport(specifier: string, moduleName: string | null, files: string[]): string[] {
  if (!moduleName || !specifier.startsWith(`${moduleName}/`)) return [];
  const directory = specifier.slice(moduleName.length + 1);
  return files.filter(file => path.posix.dirname(file) === directory);
}

function importsFor(content: string, language: string): string[] {
  if (language === 'python') {
    const imports: string[] = [];
    const pattern = /^\s*from\s+(\.+)([\w.]*)\s+import\s+([\w]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const target = match[2] ? match[2].replaceAll('.', '/') : match[3];
      imports.push(`${'../'.repeat(match[1].length - 1)}./${target}`);
    }
    return imports;
  }
  if (language === 'go') {
    return [...content.matchAll(/"([^"\n]+)"/g)].map(match => match[1]);
  }
  const patterns = language === 'rust'
    ? [/^\s*(?:mod|pub\s+mod)\s+([\w]+)\s*;/gm]
    : [
      /import\s+.*?from\s+['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /^import\s+['"]([^'"]+)['"]/gm,
    ];
  const imports: string[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) imports.push(match[1]);
  }
  return imports;
}

function buildStaticGraph(repoPath: string, language: string): DepGraph {
  const nodes = sourceFiles(repoPath, EXTENSIONS[language] ?? EXTENSIONS.unknown);
  const known = new Set(nodes);
  const edges = new Map<string, string[]>();
  let goModule: string | null = null;
  if (language === 'go') {
    try { goModule = /^module\s+(.+)$/m.exec(fs.readFileSync(path.join(repoPath, 'go.mod'), 'utf8'))?.[1]?.trim() ?? null; } catch { /* no module */ }
  }
  for (const node of nodes) {
    let content: string;
    try { content = fs.readFileSync(path.join(repoPath, node), 'utf8'); } catch { continue; }
    const resolved = importsFor(content, language).flatMap(specifier => {
      if (language === 'go') return resolveGoImport(specifier, goModule, nodes);
      const target = resolveImport(node, language === 'rust' ? `./${specifier}` : specifier, known);
      return target ? [target] : [];
    });
    if (resolved.length > 0) edges.set(node, [...new Set(resolved)]);
  }
  return { language, tool: 'static source scan', nodes, edges, circular: [] };
}

export async function buildDependencyGraph(ctx: RepoContext): Promise<DepGraph[]> {
  const graphs: DepGraph[] = [];
  for (const language of ctx.language) {
    printInfo(`Map ${language.toUpperCase()} files.`);
    graphs.push(buildStaticGraph(ctx.repoPath, language));
  }
  return graphs;
}

export function findAffectedFiles(graphs: DepGraph[], keywords: string[]): string[] {
  const scores = new Map<string, number>();
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      const score = keywords.reduce((total, keyword) => total + Number(node.toLowerCase().includes(keyword.toLowerCase())), 0);
      if (score === 0) continue;
      scores.set(node, (scores.get(node) ?? 0) + score);
      for (const [from, dependencies] of graph.edges) {
        if (dependencies.includes(node)) scores.set(from, (scores.get(from) ?? 0) + 0.5);
      }
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([file]) => file);
}
