# Happy Colors Agent Workflow

## Mandatory design-change approval flow

For any visual, animation, interaction, layout, asset, or styling change, follow this order exactly:

1. Receive the user brief.
2. Produce a design document before changing implementation code.
3. Obtain a Claude Opus review of that design document.
4. Report the reviewed plan and its findings to the user.
5. Wait for the user's explicit approval.
6. If the scope needs staged delivery, produce an implementation-phase document and obtain approval for it.
7. Only then implement.

Do not install dependencies, edit application source, delete code, change tests, or make a visual "preview" between steps 1–5. A user request to create or discuss a design document is never authorization to implement the design.

Claude Opus is an independent reviewer, not the final design authority. Evaluate its recommendations against the user brief, implementation evidence, accessibility, performance, and project context. Record the resulting reasoned consensus in the design document before implementation; do not adopt an Opus recommendation automatically.

This repository is used on Windows. Prefer commands that work in Windows shells.

## Shell rules

- Prefer commands that work in both `cmd.exe` and PowerShell when possible.
- Use double quotes in commands. Do not rely on single-quote shell behavior.
- When requesting an external review, pass the review target to the tool explicitly instead of saying "review this diff" without providing the diff.

## Secrets and env files

- Do not read or print `.env`, `.env.local`, `.env.*`, or other secret-bearing environment files unless the user explicitly asks for that exact file.
- When checking configuration, prefer verifying variable names, presence, or whether values look local/production without exposing secret values.
- Never include secrets such as passwords, tokens, API keys, JWT secrets, email app passwords, or unsubscribe secrets in chat, logs, review prompts, or copied command output.

## Architecture and reuse

- Reuse existing code first: components, pages, layouts, hooks, contexts, managers, services, controllers, routers, helpers, utilities, schemas, styles, test factories, mocks, and configuration.
- Do not create a new file, module, component, hook, helper, service, controller, route, API endpoint, style block, test utility, or abstraction when an existing one can be extended safely.
- Keep ownership in the established module for that behavior. For example, business API ownership stays in the existing Express modular routes unless a capability must run in the Next.js runtime, such as `revalidatePath` or `revalidateTag`.
- If new code surface is technically necessary, explain why existing code cannot own the behavior before implementing it, then keep the new surface as small and local as possible.
- Add an abstraction only when it removes real duplication, reduces meaningful complexity, or clearly matches an established local pattern.
- Avoid parallel implementations of the same behavior. Before adding code, search for existing behavior and reuse or extend it.

## Configuration values

- Do not hardcode changeable URLs, origins, hostnames, ports, route prefixes, external service addresses, or similar values in application code, scripts, and test setup. Define them once in a shared configuration file and reuse or derive them from there.
- Read environment overrides at the configuration boundary. Do not copy the same fallback value or assemble the same base URL independently in multiple files.
- Keep secrets in the environment, never in a committed configuration file. Literal URLs are acceptable only as independent test expectations or invalid-input fixtures, documentation examples, and required protocol/namespace identifiers; they must not become operational configuration.

## Styling guidelines

- **Global styles** are the foundation: define all common fonts, padding, margins, base layouts, colors, and reusable elements (buttons, forms, typography) in the global CSS file.
- **Component-specific styles** go in dedicated CSS files scoped to that component only. Use these files exclusively for styles that apply only to that component and do not repeat elsewhere in the project.
- Always prefer using global style definitions before creating new component styles. Override global styles in component files only when necessary.
- This ensures consistency across the UI and makes global design changes maintainable in a single location.

## Claude review

Use the Claude CLI directly when you want an external review from Claude.

Always pass `--model claude-opus-5-5` explicitly. It requires Claude Code CLI 2.1.280 or newer; if the CLI reports `claude_code_version_too_old`, run `claude update`. The default CLI model uses a 1M-context variant that requires extra usage credits which are not part of this account's plan. Without the flag, calls fail with `429 · Usage credits are required for long context requests`.

Opus also responds slowly (typically 60-180 seconds for a real diff review). The default Codex shell timeout (120s) can cut it off. When invoking Claude review, use a shell timeout of at least 300 seconds, or break large diffs into smaller chunks.

When Codex invokes Claude from this repository, run the Claude command outside the Codex sandbox by requesting escalated execution (`sandbox_permissions: require_escalated`). The default Codex sandbox runs as `l82sg\codexsandboxoffline` with `CODEX_SANDBOX_NETWORK_DISABLED=1`; in that context `claude --version` works but `claude auth status` and `claude --model claude-opus-5-5 -p "..."` can hang until timeout. Escalated execution runs as `l82sg\user` and is the expected context for Opus reviews.

Review the current working diff:

```bash
git diff | claude --model claude-opus-5-5 -p "Review this git diff for bugs, regressions, security issues, and missing tests. Give concise, actionable findings with file paths and line references where possible."
```

Review staged changes only:

```bash
git diff --cached | claude --model claude-opus-5-5 -p "Review this staged git diff for bugs, regressions, security issues, and missing tests. Give concise, actionable findings with file paths and line references where possible."
```

Rules:

- Prefer diff-based review over asking Claude to inspect the whole repository.
- Prioritize bugs, regressions, security issues, and missing tests over style suggestions.
- Treat style-only suggestions as low priority unless style review was explicitly requested.

## Codex review

Use Codex non-interactively when you want a second review pass.

```bash
codex exec --full-auto -m gpt-5.4 "Review the current implementation for bugs, regressions, security issues, and missing tests. Give concise, actionable findings with file paths and line references where possible."
```

Rules:

- Keep the prompt short and explicit.
- Weigh findings on their merits rather than accepting them blindly.

## Reviewing a file directly

If you need to review a specific file instead of a git diff, use the shell-appropriate command below.

PowerShell:

```powershell
Get-Content path\to\file.ts -Raw | claude --model claude-opus-5-5 -p "Review this file for bugs, regressions, security issues, and missing tests."
```

cmd.exe:

```cmd
type path\to\file.ts | claude --model claude-opus-5-5 -p "Review this file for bugs, regressions, security issues, and missing tests."
```

## Suggested workflow

1. Make the code changes.
2. Inspect the relevant diff locally.
3. Run the Claude diff review command.
4. Apply fixes for valid findings.
5. Optionally run a Codex review pass for a second opinion.
6. Run relevant tests before finishing.
