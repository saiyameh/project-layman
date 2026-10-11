<img width="411" height="231" alt="Project Layman" src="references/layman.png"/><br>
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

CLI and AI guidance use plain language. Commands, paths, and errors stay exact. Public drafts follow repository rules.

Panels show the step, repository, branch, saved progress, and next action. Checks show passed, failed, skipped, waiting, or unknown results. Logs are optional.
Review files, destination, diff, commit message, and PR text before publishing. Git explanations appear once per run; see `layman --help`.

Confirmed failures block publishing. Unknowns stay unverified. Agreements and maintainer approval require human evidence. Use a browser for unsupported issue forms.

Layman stores sessions and private briefs in `~/.layman`, outside contributions. It reconciles pending requests before retry. Legacy `contribute-state.json` supports manual recovery only and cannot authorize deletion.

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
