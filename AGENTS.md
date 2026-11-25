# Happy Colors Agent Workflow

## Mandatory design-change approval flow

For any visual, animation, interaction, layout, asset, or styling change, follow this order exactly:

1. Receive the user brief.
2. Produce a design document before changing implementation code.
3. Obtain a Codex (GPT) review of that design document.
4. Report the reviewed plan and its findings to the user.
5. Wait for the user's explicit approval.
6. If the scope needs staged delivery, produce an implementation-phase document and obtain approval for it.
7. Only then implement.

Do not install dependencies, edit application source, delete code, change tests, or make a visual "preview" between steps 1–5. A user request to create or discuss a design document is never authorization to implement the design.

Codex is the independent reviewer for both design documents and code changes, not the final design authority. Evaluate its recommendations against the user brief, implementation evidence, accessibility, performance, and project context. Record the resulting reasoned consensus in the design document before implementation; do not adopt a Codex recommendation automatically.

This repository is used on Windows. Prefer commands that work in Windows shells.

## Shell rules

- Prefer commands that work in both `cmd.exe` and PowerShell when possible.
- Use double quotes in commands. Do not rely on single-quote shell behavior.
- When requesting an external review, pass the review target to the tool explicitly instead of saying "review this diff" without providing the diff.

## Secrets and env files

- Follow [`AGENT_SECRET_ACCESS.md`](./AGENT_SECRET_ACCESS.md) for every task in this repository. It prohibits agents from opening any secret-bearing file, even during authentication work.
- Do not read or print `.env`, `.env.local`, `.env.*`, or other secret-bearing files. If a task needs their contents, arrange a safer workflow with the user.
- When checking configuration, use variable names in application source and check only file presence or Git tracking status; do not inspect secret values.
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

## Codex review

Codex (GPT) reviews every design document and every code change. Run it non-interactively in a read-only sandbox and pass the review target explicitly through stdin; the prompt argument is appended after the piped content.

Do not pass `-m`: the ChatGPT account rejects older pinned models such as `gpt-5.4`, and Codex uses the account default (currently `gpt-6-sol`). Always pass `-c model_reasoning_effort="xhigh"`. Reviews of real diffs can take several minutes, so use a shell timeout of at least 600 seconds, or split large inputs.

Review a design document:

```powershell
Get-Content docsdesign-file.md -Raw | codex exec -s read-only -c model_reasoning_effort="xhigh" "Review this design document for gaps, contradictions, feasibility, accessibility, performance, and missing checks. Give concise, prioritized findings."
```

Review the current working diff:

```bash
git diff | codex exec -s read-only -c model_reasoning_effort="xhigh" "Review this git diff for bugs, regressions, security issues, and missing tests. Give concise, actionable findings with file paths and line references where possible."
```

Review a specific file (PowerShell):

```powershell
Get-Content path	oile.ts -Raw | codex exec -s read-only -c model_reasoning_effort="xhigh" "Review this file for bugs, regressions, security issues, and missing tests."
```

Rules:

- Prefer diff-based review over asking Codex to inspect the whole repository; when the working tree also holds unrelated uncommitted work, pass only the relevant changes.
- Keep the prompt short and explicit, and ask for prioritized findings.
- Prioritize bugs, regressions, security issues, and missing tests over style suggestions; treat style-only suggestions as low priority unless style review was explicitly requested.
- Weigh findings on their merits rather than accepting them blindly.

## Suggested workflow

1. Make the code changes.
2. Inspect the relevant diff locally.
3. Run the Codex diff review command.
4. Apply fixes for valid findings and record the decisions in the design document.
5. Run relevant tests before finishing.
