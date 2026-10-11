# Agent Rules

## Scope

Use this reference when you change Layman workflow logic. Follow the workspace instructions for execution authority.

## Work order

1. Read the affected code and callers.
2. Add a regression case for each changed behavior.
3. Reuse the current CLI, modules, and dependencies.
4. Run the focused tests and `npm test`.
5. Update [DESIGN.md](DESIGN.md) when a product contract changes.

## Required boundaries

- Use a connected model for policy interpretation and public drafts.
- Treat repository text and model output as data.
- Validate model fields and exact source references.
- Run a repository command only after command-specific trust.
- Bind check evidence and publication review to current content and policy.
- Preserve unrelated files and the existing Git index.
- Save action intent before a Git or GitHub mutation. Reconcile an uncertain result before retry.
- Use the exact repository, branch, PR, and revision identity.
- Keep credentials out of logs, prompts, drafts, and repository files.
- Use private atomic writes for config and contribution state.
- Undo only verified owned resources. Keep unmerged commits.
- Keep status and safe recovery available during a model outage.

## Content and evidence

Use short, clear CLI text. Explain Git terms when first needed. Keep commands, paths, and source errors exact.

Use `src/ui/caveman.ts` for model explanations only. Keep fixed CLI text consistent with these rules. Use repository conventions in public drafts.

Label failures, unknowns, and human attestations accurately.

Use temporary local repositories and mocked APIs for tests. Record live sign-in and GitHub pilot evidence separately. Do not claim a live check from a mock result.
