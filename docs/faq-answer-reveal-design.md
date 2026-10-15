# FAQ: immediate desktop answer reveal and question accents

## Brief

When a desktop FAQ card opens, its answer should begin appearing immediately. Add one familiar orange vertical rule beside the question inside each FAQ card. Keep the existing card layout, expansion motion, single open card behavior, and mobile interaction.

## Current behavior and cause

`components/FaqPage.tsx` animates desktop card width (`flexGrow`) and answer height and top margin over 0.62 seconds. The answer opacity has an additional 0.65 second delay when `active && wide`, so the card visibly opens before any answer text appears. The answer shell also has `overflow: hidden`, so it can reveal text progressively while its height grows.

## Proposed change

- In the existing `FaqCard` Motion transition, replace the 0.65 second desktop opacity delay with the existing 0.08 second mobile delay. Keep the 0.28 second opacity fade. This lets the answer appear while the card expands and leaves mobile timing unchanged. Use `opacity: { duration: reducedMotion || !active ? 0 : .28, delay: reducedMotion || !active ? 0 : .08 }` so reduced-motion users have no delay at all. Continue to hide an answer immediately when its card closes.
- Keep the current 0.62 second card width and answer-height motion. Do not add CSS animation or a new dependency.
- Leave mobile height timing, scroll anchoring, and tap behavior as they are. Correct the current reduced-motion desktop delay.
- Add a decorative vertical rule beside the question in every card on desktop, tablet, and mobile. Match the existing FAQ lead accent with `border-left: .17rem solid var(--color-primary)`. Extend the existing `.faq__question-heading` style with `position: relative` and a `::before` pseudo-element using `left: -.7rem; top: 0; bottom: 0; width: 0; pointer-events: none`. This places the rule inside the card's left padding at all three breakpoints without depending on the desktop-only `--faq-padding` value: the smallest real left padding is 1.1rem. The rule ends at least .53rem before the question text, clearing the button focus outline, which extends approximately .47rem to the left. It follows the full heading line box when a long question wraps. Keep the number, question, and answer text aligned to the same existing padding edge. Do not add markup or change the card widths, gaps, or padding. The decorative rule can remain in print; no new print behavior is needed.

## Verification

- On desktop, hover with a fine pointer after the existing hover timer, and click a closed card. Confirm answer text starts appearing while the card expands, with no pause after expansion. Any right-edge clipping during width growth should remain faint and not distracting.
- Switch to another card. Confirm only one answer is visible and the previous answer hides immediately.
- Confirm the longest answer fits inside its expanded card and the mobile tap behavior is unchanged.
- Add a desktop browser assertion that the answer shell opacity becomes greater than zero within approximately 500 milliseconds from the initiating click event, using the page's `performance.now()` clock rather than the time when Playwright's `click()` returns. This distinguishes the new timing from the current 0.65 second delay without depending on one exact animation frame. Include the hover path. With reduced motion emulated before navigation, check that opacity reaches one on the next frame. Run the existing FAQ browser tests and relevant build/lint checks.
- Check that every card shows one orange rule beside its question on desktop, tablet (around 60rem), and mobile, including closed and open cards. Confirm the rule does not cover text, the button's keyboard focus outline, or the card border; still reads against the light open card; does not change card sizes; and does not cause horizontal overflow. Long wrapped questions should keep a full-height rule beside their text. In forced-colours mode, the border-based rule should remain perceivable.

## Scope and risk

Change only the answer opacity timing in `FaqCard` and the question-heading decoration in the existing FAQ CSS. The answer shell begins growing vertically with the fade, and its final width is wider than the card's initial width. The card can clip the right edge of the answer while it grows. The 0.08 second start and gradual 0.28 second fade keep that clipping unobtrusive; visually verify it during expansion. The new rules occupy each card's left padding area and do not consume grid width. The fixed card padding, typography, questions, and other pages stay as they are.

## Review and decision

Claude Opus reviewed this document on 2026-10-15. It agreed that the 0.65 second opacity delay causes the reported pause, and identified the reduced-motion delay and possible sideways clipping. We adopt the shared 0.08 second start because it retains the existing mobile feel, removes the perceptible desktop pause, and makes the answer faint while the card is narrow. We adopt the reduced-motion correction and a focused browser timing test. We keep the card expansion and hover lock unchanged because they are separate from the reported gap between card opening and answer visibility.

The request for the orange rule was added after that review. The user clarified that there should be one rule inside each card. In a further review, Opus identified the tablet and mobile padding differences, focus-outline clearance, forced-colours support, and a contradiction in the clipping check. We use a fixed text-relative offset instead of the desktop padding variable, draw the rule as a border like the existing lead, and check the partially clipped answer for visual quality rather than forbidding all clipping. We keep the rule at the heading's full line-box height so wrapped questions remain visually connected to it.
