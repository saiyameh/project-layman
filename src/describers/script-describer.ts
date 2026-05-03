import type { GitHubRepo, DescriptionProvider } from './index.js';

const ABBREVIATION_MAP: Record<string, string> = {
  'cli': 'command line tool',
  'api': 'app talking pipe',
  'ui': 'screen thing',
  'db': 'data cave',
  'auth': 'key-for-door',
  'ml': 'brain-teaching',
  'ai': 'fake brain',
  'oss': 'free for all',
  'sdk': 'builder box',
  'ssr': 'server makes page',
};

const LAYMAN_MAP: Record<string, string> = {
  'authentication': 'key for door',
  'authorization': 'who allowed go in',
  'database': 'big rock with memory',
  'api': 'magic talking pipe',
  'rest api': 'pipe that talk in web language',
  'graphql': 'smart asking pipe',
  'framework': 'strong stick help build',
  'library': 'box of pre-made tools',
  'machine learning': 'rock that learn trick',
  'deep learning': 'big brain made of math',
  'neural network': 'many brain cells connected',
  'large language model': 'word guesser with big brain',
  'docker': 'box that hold app',
  'container': 'app live in box',
  'kubernetes': 'many box wrangler',
  'websocket': 'always-open talking hole',
  'compiler': 'word-to-fire translator',
  'typescript': 'javascript but with rules',
  'javascript': 'web page make move',
  'python': 'snake language for smart things',
  'rust': 'very safe fast cave language',
  'golang': 'google cave language',
  'microservice': 'many small apps talk together',
  'monorepo': 'all code live in one big cave',
  'ci/cd': 'auto test and send out',
  'testing': 'check if thing work',
  'deployment': 'send app to cloud cave',
  'cloud': 'someone else cave',
  'serverless': 'server hide, you no see',
  'middleware': 'helper between two things',
  'parser': 'thing that read and understand words',
  'terminal': 'black box where you type commands',
  'scraper': 'steal words from web page',
  'crawler': 'walk all over web pages',
  'webhook': 'tap on shoulder when thing happen',
  'cache': 'remember thing so no fetch again',
  'queue': 'wait in line to do job',
  'orm': 'talk to data cave without magic words',
  'crud': 'make, see, change, delete thing',
  'boilerplate': 'ready-made starter cave',
  'scaffold': 'skeleton for new thing',
  'linter': 'grammar checker for code',
  'bundler': 'squish many files into one',
  'transpiler': 'translate one code language to other',
  'proxy': 'middleman who pass messages',
  'load balancer': 'split work so no one tired',
  'encryption': 'scramble words so enemy no read',
  'hashing': 'turn thing into secret number',
  'token': 'secret pass for entering',
  'jwt': 'signed secret pass',
  'oauth': 'let other login system do job',
  'async': 'do many things at same time',
  'concurrency': 'many things happen together',
  'webscraping': 'grab words from web page',
  'dashboard': 'screen with many numbers',
  'visualization': 'make number into picture',
  'plugin': 'extra tool you add on',
  'extension': 'add more power to thing',
  'workflow': 'steps to finish job',
  'automation': 'machine do job instead of human',
  'template': 'ready shape to fill in',
  'component': 'small reusable screen piece',
  'state management': 'remember what happening in app',
  'routing': 'send user to right page',
  'pagination': 'split many things into pages',
  'serialization': 'turn thing into sendable words',
  'deserialization': 'turn words back into thing',
  'react': 'facebook screen builder',
  'vue': 'friendly screen builder',
  'angular': 'google screen builder',
  'next.js': 'react but with server powers',
  'svelte': 'disappearing screen builder',
  'tailwind': 'ready-made paint for screen',
  'redux': 'brain that remember all app stuff',
  'git': 'time machine for code',
  'repository': 'cave where code live',
  'regex': 'magic word pattern matcher',
  'algorithm': 'step-by-step thinking recipe',
  'backend': 'hidden worker behind wall',
  'frontend': 'shiny thing user see',
  'fullstack': 'do everything cave person',
  'devops': 'bridge builder between make and send',
  'http': 'web talking rules',
  'ssl': 'lock on web door',
  'dns': 'name finder for web caves',
};

const VERB_MAP: Record<string, string> = {
  'utilizes': 'use',
  'facilitates': 'help with',
  'implements': 'make',
  'enables': 'let you',
  'leverages': 'use',
  'provisions': 'set up',
  'orchestrates': 'control',
  'abstracts': 'hide hard part of',
  'encompasses': 'cover',
  'provides': 'give',
  'supports': 'help',
  'integrates': 'connect',
  'optimizes': 'make faster',
  'generates': 'create',
  'configures': 'set up',
  'validates': 'check',
  'transforms': 'change shape of',
  'deploys': 'send out',
  'manages': 'take care of',
  'handles': 'deal with',
};

const FLAVOR_REPLACEMENTS: [RegExp, string][] = [
  [/\b(good|great|powerful|robust|production[- ]?ready)\b/gi, 'STRONG'],
  [/\b(fast|quick|efficient|performant|blazing)\b/gi, 'FAST LIKE MAMMOTH'],
  [/\b(simple|easy|lightweight|minimal)\b/gi, 'even baby cave person understand'],
  [/\b(modern|new|next[- ]?generation|cutting[- ]?edge)\b/gi, 'shiny new'],
  [/\b(secure|safe)\b/gi, 'no enemy get in'],
  [/\bscalable\b/gi, 'grow big like mammoth'],
  [/\b(open[- ]?source|free)\b/gi, 'free for all cave people'],
];

const ENDINGS = [
  ' CAVE PERSON LIKE.',
  ' MANY STAR MEAN GOOD.',
  ' UGH UGH.',
];

export class ScriptDescriber implements DescriptionProvider {
  async describe(repo: GitHubRepo): Promise<string> {
    if (!repo.description) {
      return 'UGH. THIS THING EXIST. CAVE PERSON NOT KNOW MORE. UGH.';
    }

    let text = repo.description;

    text = this.normalize(text);
    text = this.applyKeywordMap(text);
    text = this.simplifyVerbs(text);
    text = this.removeArticles(text);
    text = this.injectFlavor(text);
    text = this.wrapCaveman(text, repo.stars);
    text = this.finalize(text);

    return text;
  }

  private normalize(text: string): string {
    text = text.toLowerCase();
    text = text.replace(/[^\w\s\-\/\.]/g, '');
    for (const [abbr, expansion] of Object.entries(ABBREVIATION_MAP)) {
      const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
      text = text.replace(regex, expansion);
    }
    return text;
  }

  private applyKeywordMap(text: string): string {
    const sortedKeys = Object.keys(LAYMAN_MAP).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      const regex = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      text = text.replace(regex, LAYMAN_MAP[key]);
    }
    return text;
  }

  private simplifyVerbs(text: string): string {
    for (const [verb, simple] of Object.entries(VERB_MAP)) {
      const regex = new RegExp(`\\b${verb}\\b`, 'gi');
      text = text.replace(regex, simple);
    }
    return text;
  }

  private removeArticles(text: string): string {
    return text.replace(/\b(a|an|the)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  }

  private injectFlavor(text: string): string {
    for (const [pattern, replacement] of FLAVOR_REPLACEMENTS) {
      text = text.replace(pattern, replacement);
    }
    return text;
  }

  private wrapCaveman(text: string, stars: number): string {
    const ending = ENDINGS[stars % 3];
    return `UGH. ${text}${ending}`;
  }

  private finalize(text: string): string {
    text = text.charAt(0).toUpperCase() + text.slice(1);
    if (text.length > 120) {
      text = text.substring(0, 117) + '...';
    }
    return text;
  }
}
