# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Email: [saiyamjainworkmail@gmail.com](mailto:saiyamjainworkmail@gmail.com)

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

We will respond within 7 days.

## Token handling

Project Layman stores your GitHub Personal Access Token at `~/.layman/config.json` with file permissions set to `600` (owner read/write only). The token is never logged or written to any file other than that config. It is only sent to:

- `api.github.com` — for repo search, fork, PR, and issue operations
- Your configured LLM provider — only if `description_mode: llm` is enabled

The `--contribute` flow also scans staged files for patterns matching secrets (`.env`, `*.key`, `*.pem`, credential filenames) and warns before staging.
