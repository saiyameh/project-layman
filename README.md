# Project Layman

> Search GitHub like a caveman. Fork what you like. Start building.

A terminal app that lets you search GitHub by domain or idea, displays results with caveman-style plain-English descriptions, lets you fork/star repos, and opens them in your preferred editor.

## Quick Start

```bash
# One-line install
curl -fsSL https://raw.githubusercontent.com/your-username/project-layman/main/install.sh | bash

# Or install manually via npm
npm install -g project-layman

# Run it
layman
```

On first run, a setup wizard will guide you through configuration.

## Setup Requirements

- **Node.js** v18 or higher
- **Git** installed and configured
- **GitHub Personal Access Token** with `repo` and `read:user` scopes
  - Create one at: https://github.com/settings/tokens

> **Tip:** If you have `GITHUB_TOKEN` or `GH_TOKEN` set in your environment, Layman will detect and offer to use it automatically.

## Usage

### Interactive Mode

```bash
layman
```

1. Enter a search topic (e.g., "rust web servers")
2. Choose how many results
3. Browse the caveman-described results table
4. Select repos to fork & clone, star, or preview README
5. Open cloned repos in your editor

### Direct Search

```bash
layman --query "react state management" --count 20
```

### JSON Output (for piping)

```bash
layman --query "python ML" --json | jq '.[] | .name'
```

## CLI Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--query` | `-q` | Search query (skip interactive prompt) |
| `--count` | `-c` | Number of results, 1-50 (default: 10) |
| `--sort` | `-s` | Sort by: `stars`, `forks`, `updated` |
| `--language` | `-l` | Filter by programming language |
| `--mode` | | Description mode: `script` or `llm` |
| `--editor` | | Editor command override for this run |
| `--json` | | Output results as JSON |
| `--history` | | View past search queries |
| `--reset` | | Reset configuration |
| `--help` | `-h` | Show help |
| `--version` | `-v` | Show version |

## Description Modes

### Caveman Script (default)

Offline, deterministic transformation pipeline that converts repo descriptions into caveman-speak. No API key needed.

```
"A lightweight TypeScript ORM for PostgreSQL"
-> "UGH. even baby cave person understand javascript but with rules talk to data cave without magic words. CAVE PERSON LIKE."
```

### LLM-Powered

Uses AI to generate richer caveman descriptions. Supports:

- **Anthropic** (Claude Haiku)
- **OpenAI** (GPT-4o Mini)
- **Ollama** (local models)

Configure during setup or override with `--mode llm`.

## Supported Editors

Layman auto-detects these editors from your PATH:

| Editor | Command |
|--------|---------|
| VS Code | `code` |
| Cursor | `cursor` |
| Zed | `zed` |
| WebStorm | `webstorm` |
| IntelliJ IDEA | `idea` |
| Sublime Text | `subl` |
| Vim | `vim` |
| Neovim | `nvim` |

You can also specify any custom editor command.

## Security

- Your GitHub token is stored in `~/.layman/config.json` with `600` file permissions (owner read/write only)
- Supports `GITHUB_TOKEN` / `GH_TOKEN` environment variables as an alternative
- No tokens are ever transmitted except to GitHub's API and your configured LLM provider

## Project Structure

```
project-layman/
├── src/
│   ├── index.ts                  # Main orchestrator
│   ├── config.ts                 # Config management + setup wizard
│   ├── github.ts                 # GitHub API client
│   ├── workspace.ts              # Editor detection + workspace opener
│   ├── describers/
│   │   ├── index.ts              # Types + factory
│   │   ├── script-describer.ts   # Offline caveman pipeline
│   │   └── llm-describer.ts      # LLM-powered descriptions
│   ├── ui/
│   │   ├── prompts.ts            # Interactive prompts
│   │   └── display.ts            # Terminal display utilities
│   └── __tests__/
│       └── script-describer.test.ts
├── install.sh
├── package.json
├── tsconfig.json
└── README.md
```

## Development

```bash
# Clone the repo
git clone https://github.com/your-username/project-layman.git
cd project-layman

# Install dependencies
npm install

# Run in development
npm run dev

# Build
npm run build

# Run tests
npm test
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-thing`
3. Make your changes
4. Run tests: `npm test`
5. Commit: `git commit -m 'Add amazing thing'`
6. Push: `git push origin feature/amazing-thing`
7. Open a Pull Request

## License

MIT
