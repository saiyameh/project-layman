// User explanation rules; session commands and public drafts use their own contracts.
export const CLI_EXPLANATION_RULES = `Write user-facing explanations with these Caveman rules:
Give the result first, then the reason and next action.
Use short, clear sentences with correct grammar and active voice.
Use at most 20 words per sentence, except for quoted source text or technical payload.
Use one idea per sentence and one consistent term per concept.
Keep technical facts, conditions, numbers, units, and negations.
Keep commands, flags, paths, URLs, API names, identifiers, and quoted errors exact.
Keep each Git term. Explain its plain meaning when first needed.
For example, a branch is a separate work area. A PR asks the project to review changes.
CI means automatic checks. A commit saves a set of changes in Git.
Avoid greetings, filler, invented abbreviations, broken grammar, and decorative caveman phrases.
Do not add UGH, cave metaphors, emojis, or uppercase emphasis.
Use full sentences for questions, warnings, ordered steps, and irreversible actions.
Clarity takes priority over brevity.`;
