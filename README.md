<img width="411" height="231" alt="Screenshot 2026-05-03 at 15 30 57" src="https://github.com/user-attachments/assets/0b8650b5-b3bc-4f47-9f4e-59646b7c71a1" /><br>
> UGH. search projects like caveman. fork what you like. start building.
```
┌─────┬────────────────────────────┬─────────┬──────────┬──────────────────────────────────────────┐
│ #   │ Name                       │ Stars   │ Lang     │ UGH-DESCRIPTION                          │
├─────┼────────────────────────────┼─────────┼──────────┼──────────────────────────────────────────┤
│ 1   │ tokio-rs/tokio             │  28.3k  │ Rust     │ UGH. very safe fast cave language make...│
│ 2   │ actix/actix-web            │  22.1k  │ Rust     │ UGH. STRONG web strong stick help bui....│
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

## Requirement
**GitHub PAT** with `repo` + `read:user` scopes ([create one](https://github.com/settings/tokens))
> Auto-detects `GITHUB_TOKEN` / `GH_TOKEN` from your environment.

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

## Development

```bash
npm install        # install deps
npm run dev        # run with tsx
npm run build      # compile TypeScript
npm run doctor     # run diagnostics
```
