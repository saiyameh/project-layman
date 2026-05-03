# Project Layman

> UGH. Search GitHub like caveman. Fork what you like. Start building.

CLI tool that searches GitHub repos by topic, translates descriptions into caveman-speak, and lets you fork, star, clone, and open them in your editor -- all from the terminal.

```
┌─────┬────────────────────────────┬─────────┬──────────┬──────────────────────────────────────────┐
│ #   │ Name                       │ Stars   │ Lang     │ UGH-DESCRIPTION                          │
├─────┼────────────────────────────┼─────────┼──────────┼──────────────────────────────────────────┤
│ 1   │ tokio-rs/tokio              │ 28.3k   │ Rust     │ UGH. very safe fast cave language make... │
│ 2   │ actix/actix-web             │ 22.1k   │ Rust     │ UGH. STRONG web strong stick help bui... │
└─────┴────────────────────────────┴─────────┴──────────┴──────────────────────────────────────────┘
```

## Install

```bash
# Clone and link globally
git clone https://github.com/saiyameh/project-layman.git
cd project-layman
npm install && npm run build && npm link

# Then run from anywhere
layman
```

First run triggers a setup wizard (GitHub token, editor, description mode).

## Requirements

- **Node.js** v18+
- **Git**
- **GitHub PAT** with `repo` + `read:user` scopes ([create one](https://github.com/settings/tokens))

Auto-detects `GITHUB_TOKEN` / `GH_TOKEN` from your environment.

## Usage

```bash
layman                                    # interactive mode
layman --query "rust web servers" -c 20   # direct search
layman --query "python ML" --json         # pipe-friendly JSON output
layman --doctor                           # check if setup is healthy
layman --history                          # view past searches
layman --reset                            # reconfigure
```

## CLI Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--query` | `-q` | Search query (skip prompt) |
| `--count` | `-c` | Number of results, 1-50 (default: 10) |
| `--sort` | `-s` | Sort by: `stars`, `forks`, `updated` |
| `--language` | `-l` | Filter by programming language |
| `--mode` | | Description mode: `script` or `llm` |
| `--editor` | | Editor command override |
| `--json` | | Output as JSON |
| `--doctor` | | Run setup diagnostics |
| `--history` | | View search history |
| `--reset` | | Reset configuration |
| `--help` | `-h` | Show help |
| `--version` | `-v` | Show version |

## Description Modes

**Caveman Script** (default) -- Offline deterministic pipeline. No API key needed. Replaces jargon with caveman-speak through 7 transform steps: normalize, keyword map, verb simplify, article removal, flavor inject, caveman wrap, truncate.

```
"A lightweight TypeScript ORM for PostgreSQL"
-> "UGH. even baby cave person understand javascript but with rules talk to data cave without magic words. CAVE PERSON LIKE."
```

**LLM-Powered** -- Uses AI for richer descriptions. Supports Anthropic (Claude Haiku), OpenAI (GPT-4o Mini), and Ollama (local). Includes `p-limit` concurrency (3 parallel), exponential backoff retry, and silent fallback to script mode on failure.

## Editors

Auto-detects from PATH: `code` (VS Code), `cursor`, `zed`, `webstorm`, `idea`, `subl`, `vim`, `nvim`. Custom commands supported. GUI editors launch detached; terminal editors get `stdio: inherit`.

## Architecture

```
src/
├── index.ts              # CLI entry + orchestrator
├── config.ts             # ~/.layman/ config, cache, history, setup wizard
├── github.ts             # Octokit search, fork (poll-based), clone, star, README fetch
├── doctor.ts             # --doctor diagnostics (14 checks)
├── workspace.ts          # Editor detection + opener
├── describers/
│   ├── index.ts          # GitHubRepo interface + factory
│   ├── script-describer  # 7-step offline pipeline (80+ keyword mappings)
│   └── llm-describer     # Anthropic/OpenAI/Ollama with retry + fallback
└── ui/
    ├── prompts.ts        # clack interactive prompts (all isCancel-guarded)
    └── display.ts        # Table rendering, JSON output, status messages
```

## Key Design Decisions

- **No `conf` package** -- manual `fs` read/write to `~/.layman/config.json`, `chmod 600`
- **Token security** -- env var support (`GITHUB_TOKEN`), validated against API during setup, file permissions locked
- **Poll-based fork wait** -- retries `repos.get()` up to 15 times instead of hardcoded `setTimeout(3000)`
- **Clone URL from username** -- always constructs URL from authenticated user, not fork API response
- **SSH support** -- detects `~/.ssh/id_*` keys, offers HTTPS vs SSH choice
- **Search caching** -- results cached to `~/.layman/cache.json` with 10-min TTL
- **Graceful exit** -- `SIGINT`/`SIGTERM` handlers + `isCancel()` on every clack prompt

## Development

```bash
npm install        # install deps
npm run dev        # run with tsx
npm run build      # compile TypeScript
npm run doctor     # run diagnostics
```

## License

MIT
