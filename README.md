<img width="411" height="231" alt="Screenshot 2026-05-03 at 15 30 57" src="https://github.com/user-attachments/assets/0b8650b5-b3bc-4f47-9f4e-59646b7c71a1" /><br>
> UGH. ME WANT CONTRIBUTE. TOOL HANDLE REST. fork what you like. start building.
```
┌─────┬─────────────────────────┬─────────┬──────────┬──────────────────────────────────────────┐
│ #   │ Name                    │ Stars   │ Lang     │ UGH-DESCRIPTION                          │
├─────┼─────────────────────────┼─────────┼──────────┼──────────────────────────────────────────┤
│ 1   │ tokio-rs/tokio          │  28.3k  │ Rust     │ UGH. very safe fast cave language make...│
│ 2   │ actix/actix-web         │  22.1k  │ Rust     │ UGH. STRONG web strong stick help bui....│
└─────┴─────────────────────────┴─────────┴──────────┴──────────────────────────────────────────┘
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/saiyameh/project-layman/master/install.sh | bash
```

Or:

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

**Node.js v18+** and **Git** must be installed.

**GitHub PAT** with `repo` + `read:user` scopes ([create one](https://github.com/settings/tokens)) — needed for search, fork, clone, and the `--contribute` flow (issue creation, PR submission).

> Auto-detects `GITHUB_TOKEN` / `GH_TOKEN` from your environment.

## Usage

```bash
layman                                       # interactive mode
layman --query "rust web servers" -c 20      # direct search
layman --query "python ML" --json            # pipe-friendly JSON output
layman --doctor                              # check if setup is healthy
layman --history                             # view past searches
layman --reset                               # reconfigure
layman --contribute ./my-fork                # guided OSS contribution flow
layman --contribute                          # same, defaults to current directory
layman --undo                                # undo last --contribute action
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
| `--contribute` | | Guided OSS contribution flow (optional path, defaults to cwd) |
| `--undo` | | Undo the last `--contribute` action (stepwise) |
| `--doctor` | | Run setup diagnostics |
| `--history` | | View search history |
| `--reset` | | Reset configuration |
| `--help` | `-h` | Show help |
| `--version` | `-v` | Show version |

## Contribute flow (`--contribute`)

`layman --contribute [path]` turns a cloned fork into a pull request with minimal friction:

1. **Preflight** — verifies the repo is a valid fork, sets up remotes, detects if your fork is stale and offers to sync
2. **Guide ingestion** — reads `CONTRIBUTING.md` (or README sections, GitHub API, PR templates) to learn the repo's rules
3. **Intent** — asks what you want to do; uses an LLM to analyse scope and produce a `[MUST]`/`[SHOULD]`/`[NICE]` checklist
4. **Dependency graph** — maps affected files across JS/TS, Go, Rust, and Python codebases
5. **Brief** — writes `LAYMAN_BRIEF.md` in the repo root and opens it in your editor
6. **Workflow** — branch → stage (with secret-file detection) → commit (editable message) → push → PR → CI polling

`layman --undo` walks back the last action one step at a time: PR → push → branch.

> Requires an LLM provider to be configured (run `layman --reset` to set one up).

## LLM Providers

When description mode is set to `llm`, or for the `--contribute` flow:

| Provider | Notes |
|----------|-------|
| Anthropic (Claude) | `claude-haiku-4-5` / sonnet / opus |
| OpenAI | `gpt-4o-mini` / `gpt-4o` |
| OpenAI-compatible | Groq, Together.ai, Mistral, DeepSeek, Perplexity, LM Studio, vLLM — any OpenAI-compatible endpoint |
| Ollama | Local models — llama3, mistral, phi3, and others |

## Editors

Auto-detects from PATH: `code` (VS Code), `cursor`, `zed`, `webstorm`, `idea`, `subl`, `vim`, `nvim`. Custom commands supported. GUI editors launch detached; terminal editors get `stdio: inherit`.

## Architecture

```
src/
├── index.ts              # CLI entry + orchestrator
├── config.ts             # ~/.layman/ config, cache, history, setup wizard
├── github.ts             # Octokit search, fork (poll-based), clone, star, README fetch
├── doctor.ts             # --doctor diagnostics (16 checks)
├── workspace.ts          # Editor detection + opener
├── contribute/
│   ├── index.ts          # --contribute entry point
│   ├── preflight.ts      # Fork setup, upstream detection, archived check, stale sync
│   ├── reader.ts         # CONTRIBUTING.md ingestion (5-step cascade)
│   ├── intent.ts         # LLM intent analysis + keyword extraction
│   ├── deps.ts           # Polyglot dependency graph (JS/TS, Go, Rust, Python)
│   ├── highlight.ts      # LAYMAN_BRIEF.md writer + editor opener
│   ├── workflow.ts       # Branch → stage → commit → push → PR + CI polling
│   └── llm.ts            # LLM abstraction (Anthropic / OpenAI / Ollama / compatible)
├── describers/
│   ├── index.ts          # GitHubRepo interface + factory
│   ├── script-describer  # 7-step offline pipeline (80+ keyword mappings)
│   └── llm-describer     # Anthropic/OpenAI/Ollama/openai-compatible with retry + fallback
└── ui/
    ├── prompts.ts        # clack interactive prompts (all isCancel-guarded)
    └── display.ts        # Table rendering, JSON output, status messages
```

## Development

```bash
npm install        # install deps
npm run dev        # run with tsx (no build step)
npm run build      # compile TypeScript
npm run doctor     # run diagnostics
```
