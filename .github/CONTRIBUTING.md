# Contributing to Project Layman

## Setup

```bash
git clone https://github.com/saiyameh/project-layman.git
cd project-layman
npm install
npm run build
npm link   # makes `layman` available globally from your local source
```

## Development

- `npm run dev` — run directly with tsx (no build step needed)
- `npm run build` — compile TypeScript to `dist/`
- `layman --doctor` — verify your environment is set up correctly

## Submitting changes

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Make changes, then build: `npm run build`
4. Push and open a PR against `master`

## Code conventions

- TypeScript strict mode throughout
- No comments unless the *why* is non-obvious
- All user-facing messages use caveman voice: start with `UGH.`, all caps
- All `@clack/prompts` calls must be wrapped with `p.isCancel` guards
- No `process.exit` outside of `src/index.ts` and explicit error paths

## Project structure

```
src/
├── index.ts          CLI entry + flag parsing
├── config.ts         Setup wizard, config file, cache, history
├── github.ts         GitHub API (search, fork, clone, star)
├── doctor.ts         --doctor diagnostics
├── workspace.ts      Editor detection + opener
├── contribute/       --contribute flow (8 modules)
├── describers/       Repo description pipeline (script + LLM)
└── ui/               Prompts and display helpers
```
