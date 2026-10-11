# Security Policy

## Report a vulnerability

Send a private report to [saiyamjainworkmail@gmail.com](mailto:saiyamjainworkmail@gmail.com). Include the affected command, reproduction steps, and impact. Do not publish credentials or a vulnerability in a public issue.

## Credentials

Layman stores API keys, GitHub tokens, and OpenAI OAuth tokens in `~/.layman/config.json`. Config and state writes use private temporary files and atomic replacement. Files use mode `600`; new config directories use mode `700`. Protect this directory and its backups.

OpenAI OAuth uses PKCE, state, nonce, verified identity tokens, and account binding. Failed sign-in leaves the old config in place. Other providers use their supported key or local endpoint paths.

## Model data

The selected provider receives contribution rules, intent, selected changes, draft context, and requested PR status explanations. Known credential values and recognizable secret patterns stop model requests. This scan cannot identify every private value. Review the selected repository and provider before contribution work.

GitHub receives approved issue and PR content. Git transport uses your Git credentials. Layman does not put API tokens in clone or push URLs.

## Commands and publication

Approve each repository command before execution. A trusted command can change files, read local files, access the network, or download tools. Layman removes common credential environment variables, limits execution time, and records results.

Review exact files and public text before publication. Tool files and recognizable secrets are excluded or blocked. Undo and cleanup require recorded ownership and fresh Git/GitHub checks. Unmerged local commits are kept.
