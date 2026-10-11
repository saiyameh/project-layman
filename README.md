> Write code. Layman handles contribution steps.

> Layman is a CLI harness for GitHub contributions. You write code in your editor. Layman reads repository rules, records checks, prepares public text, and tracks the PR.

## Install

Use Node.js 18 or later and Git.

On macOS or Linux, use the Bash installer:

```bash
curl -fsSL https://raw.githubusercontent.com/saiyameh/project-layman/master/install.sh | bash
```

The script installs to `~/.layman-src`. It builds Layman and links the command. It does not run `sudo` or start setup.
Set `LAYMAN_INSTALL_DIR` to use another absolute folder path.
After installation, run `layman`. If linking fails, use the direct command shown by the script.

Or build from source:

```bash
git clone https://github.com/saiyameh/project-layman.git
cd project-layman
npm ci --include=dev
npm run build
npm link
layman
```

Connect a GitHub token, a model, and an editor. Configure Git transport access separately with SSH or a Git credential manager.

Run `layman` in a terminal to start a contribution, resume saved work, or find a project.
For scripts, use explicit flags such as `--contribute`, `--query`, or `--json`.

## Connect a model

```bash
layman --brain
```

Use Anthropic or OpenAI API keys, a local Ollama model, or an OpenAI-compatible endpoint. Use HTTPS for remote endpoints. Local endpoints can use HTTP.

OpenAI also supports **Sign in with ChatGPT** through its documented open-source OAuth flow. Account eligibility and provider limits apply. Other providers use keys or local endpoints; Layman does not reuse credentials from their CLI tools.

The guided workflow requires a working model. Search descriptions can still use script mode. Status and safe recovery remain available when the model is down.

## Contribution steps

```bash
layman --contribute ./repo                 # prepare and save a contribution
layman --contribute https://github.com/owner/repo
layman --contribute ./repo --issue 123      # link a verified open issue
layman --contribute ./repo --new            # prepare another contribution
cd ./repo
layman --resume                            # choose the next saved step
layman --check                             # approve and run project checks
layman --submit                            # review exact files and public text
layman --status                            # read CI, reviews, merge, or closure
layman --cleanup                           # clean owned resources after a terminal PR
layman --undo                              # undo a verified owned resource
```

1. **Connect model:** check the selected model.
2. **Read rules:** review repository rules and unknown requirements. Complete personal agreements yourself.
3. **Prepare work:** select a branch, a separate work area. Write code in your editor.
4. **Check work:** select contribution files. Approve each project command before execution.
5. **Review and publish:** inspect the diff, the changed lines, and the public text. Confirm publication.
6. **Wait for review:** inspect CI, the automatic checks, and maintainer feedback. Submit revisions to the same PR.
7. **Finish contribution:** report merge or closure. Keep unrelated resources and unmerged commits.

A PR asks the project to review your changes. A commit saves changes in Git.

CLI text uses short, clear sentences and plain explanations beside Git terms.
AI explanations use the same rules. Commands, paths, and source errors stay exact. Public drafts follow repository conventions.

Contribution panels show the current step, repository, branch, saved progress, and next action.
Check summaries separate passed, failed, skipped, waiting, and unknown results. Open log details when needed.
Review the exact files, destination, diff, commit message, and PR text before publication.
Contribution prompts explain Git terms once per CLI run. Use `layman --help` to read them again.

Confirmed failures block publication. Unknowns remain unknown after review. Personal agreements and maintainer approval need human evidence. Issue forms that require browser fields use a browser handoff.

Layman saves sessions and private briefs under `~/.layman`. It does not add tool files to your contribution. A failed request remains pending until its result is reconciled. Legacy `contribute-state.json` is kept for manual recovery and cannot authorize deletion.

## Search and diagnostics

```bash
layman --query "rust web servers" -c 20
layman --query "python ML" --json
layman --history
layman --doctor
layman --help
```

## Development

```bash
npm run dev
npm test
```

Read [agent rules](references/AGENTS.md) before changing workflow logic. Read [design](references/DESIGN.md) before changing stages or CLI behavior. See [security](.github/SECURITY.md) for credentials and data handling.

Live provider login and a public GitHub pilot are release checks. Local tests use disposable repositories and mocked APIs.
