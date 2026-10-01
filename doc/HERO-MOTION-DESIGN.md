# Hero motion design — Motion-only revision for approval

**Status:** existing entrance implemented; the user approved the 30 September 2026 motion-policy revision for implementation.

## Objective

Create a cinematic but restrained first scene for the home page. It should feel immediate on load, preserve clear hierarchy and reading comfort, and provide a stable foundation for later scroll scenes.

## Static composition

1. The supplied hero background is fully static. It does not translate, scale, fade, parallax, or change source while the hero is visible. **User decision, 30 September 2026:** the background and its shade are fixed to the viewport (`position: fixed`); the hero content and later sections scroll over it. The footer is positioned above it. The “Scroll down” cue is removed.
2. The horizontal WebCreativeTeam logo stays in the upper-left corner without an entrance effect.
3. The header retains generous top spacing. **User decision, 30 September 2026:** the air between the horizontal logo and the headline is reduced by 20% from the previous layout (headline top margin `clamp(3rem, 7vh, 5.5rem)`).
4. The headline uses the left side of the viewport and may occupy most of its height. Its text stays real HTML and must never be clipped for Bulgarian or English.
5. The circular logo is positioned on the right on desktop. Its rendered width is **40% smaller** than the previous circular-logo implementation. The exact responsive size is established from that baseline rather than a fixed pixel value.
6. The description remains real HTML, accessible before JavaScript loads. **User decision, 30 September 2026:** the two hero CTAs are removed. Below the description sits an orange (`--color-primary`), decorative (`aria-hidden`) scroll arrow drawn in the supplied thin-stroke style, `clamp(5.5rem, 7.2vw, 8rem)` wide (doubled at the user's request). It points left at the top of the page and turns to point down over the first 40% of a viewport height of scroll (Motion `useScroll` + `useTransform`); scrolling back reverses it.
7. **User decision, 30 September 2026 — desktop first scene fits the viewport.** Headline, circular logo, description and scroll arrow are all visible without scrolling. Desktop uses a two-column grid: the headline spans the left column; the circular logo and, beneath it, the description and arrow stack in the right column, with their bottom aligned to the headline's bottom. The headline size is `clamp(4.5rem, min(12vw, 20svh), 14.5rem)`, so its longest line (EN "UNNOTICED") never reaches the right column up to ultra-wide screens. An e2e test checks 1280×720, 1440×900, 1920×1080 and 2560×1440 in both locales. **Revision, 30 September 2026:** the gap between the headline and the right column is `1.3 × headline font size` (the proportion approved on the user's 2560 px monitor), shrinking to a 2rem minimum when a long headline needs the room; the right column is no longer pinned to the far right edge, so laptops (1536×864 at 125% scaling) keep the same composition. The circular logo has `clamp(1.25rem, 4vh, 3rem)` extra space below it. The description column is `clamp(22rem, 28vw, 27rem)` wide.

## Desktop entrance sequence

The page must never look as if it is slow to load. The background and horizontal logo are present immediately. The moving elements complete their primary entrance in about **2.4 seconds**.

| Order | Element | Behaviour | Timing |
| --- | --- | --- | --- |
| 0 | Background and horizontal logo | Immediately visible and static | first paint |
| 1 | Circular logo | Clearly visible reveal with upward travel and scale to final size, then continuous rotation | starts at 350 ms; reveal lasts 1.2 s |
| 2 | Headline | Lines rise through masks in sequence | starts after the orb; 250 ms stagger; each line lasts 900 ms |
| 3 | Description and scroll arrow | One visible fade-and-rise group after the headline | starts at about 1.7 s; reveal lasts 700 ms |

The horizontal logo has no motion. It is the stable visual anchor for the scene. The primary sequence completes in about 2.4 seconds.

## Circular logo interaction

- At rest it rotates around its Z axis at one turn every 24 seconds (user decision, 30 September 2026: slower than the earlier 6-second turn). The rotating asset is `2026_Redesign/Assets/Hero logo 1.webp`, the transparent three-swirl logo without the surrounding glass rings.
- With a mouse or trackpad pointer over the orb, it tilts subtly on X and Y axes, up to 6–8 degrees, and returns softly to neutral on pointer leave.
- The effect creates a depth illusion from the supplied transparent image. It is not a WebGL or Three.js scene.
- Touch devices do not receive tilt input.
- The orb image is decorative. Its separate rotation control is a keyboard target.

### Visible-start contract

The previous Motion timing was too short and too subtle to be perceived reliably. The replacement is deliberately longer, with a clear first movement after the page has mounted. CSS animations remain removed.

## Scroll direction after the hero

The hero background becomes the visual field behind later sections. Future content scenes enter from below, cover the preceding content, and then give way to the next scene through native browser scrolling.

- No smooth-scroll library or scroll hijacking.
- Every later scene receives its own approved layout and animation brief before implementation.
- The current services, projects, and contact compositions do not define those future scenes.

## Mobile and motion behaviour

- Mobile receives the same Motion entrance sequence in content-first order: horizontal logo, then the headline, circular logo, description and scroll arrow.
- The headline uses the full available viewport width, constrained only by a responsive horizontal page padding. It does not inherit the narrower desktop text column.
- On mobile the headline fills the content width: `font-size = (100vw - 2 × gutter) / --hero-fit`, where `--hero-fit` is the longest line's width in em for each locale (BG 4.33, EN 4.74, measured with ~1% margin). Lines never wrap. The value must be re-measured when the headline copy changes; an e2e test at 320, 390 and 430 px enforces ≥95% fill without overflow.
- The circular logo remains visible directly below the mobile headline. It is decorative and must not overlap or reduce the readable width of the heading, description or CTAs.
- On mobile, its maximum rendered width is the smaller of 44vw and 18svh. It has at least 1rem vertical spacing from the headline and following copy.
- **Header CTA (user decision, 30 September 2026):** a “Да работим заедно” / “Let's work together” button sits in the header, directly left of the menu icon, on every page, linking to `#footer-contact`. From 520 px down, the header logo is 9rem and the CTA font becomes smaller; from 379 px down, the logo is 8.5rem and the CTA font becomes smaller again. The CTA's padding stays proportional to its font size as specified in the 1 October proposal below. Below 360 px the CTA is hidden because the logo, CTA and menu cannot fit (contact stays reachable in the footer).
- **User decision, 30 September 2026:** the full entrance, orb rotation and pointer tilt run for every visitor, including when the operating system reports `prefers-reduced-motion: reduce`. Windows “Animation effects” can be disabled for performance, which had prevented visitors, including the user, from seeing this scene.
- The ongoing rotation has a subdued grey (semi-transparent white on a translucent dark fill, brighter on hover/focus/pressed) 28×28 CSS px keyboard-accessible pause/resume button (reduced from 40 px at the user's request; still above the WCAG 2.5.8 AA 24 px minimum), placed at the lower-right of the orb on desktop and mobile, with a visible focus indicator and contrast against the image. The button uses a fixed localized accessible name (“Пауза на въртенето” / “Pause logo rotation”); `aria-pressed=true` means pause is active. Its icon switches between pause and play. Pausing preserves the exact current angle; leaving and returning to the viewport does too.
- No essential content depends on animation, hover, pointer movement or JavaScript.

## Technical approach — Motion-only entrance, revision 2

- Remove every current hero CSS keyframe, CSS `animation` declaration and CSS animation delay. They are the failed mechanism and must not remain as a fallback or run in parallel with Motion.
- `motion` owns the entire entrance: the circular logo reveal and continuous rotation, each headline line, and the description-and-arrow group, and the scroll-linked arrow rotation. No second animation system is introduced.
- The background stays a real, static, priority-loaded `<img>`. It is never animated or used as an animation gate.
- Remove the bootstrap script, `data-hero-motion*` attributes, image-decode waiting, timer fallbacks, global CSS starting-state rules and imperative `useAnimate` timeline. They make two sources of truth and can silently skip the visible sequence.
- Motion owns initial and final states through declarative variants on one client boundary. The parent controls `delayChildren` and stagger; children receive their own `hidden` and `visible` variants. There is no CSS animation or CSS motion state.
- The first visible Motion movement waits 350 ms after mount, allowing the browser to finish hydration work before the sequence starts.
- The orb starts at `scale: .55` and `y: 110`, fades in over 250 ms, then continues to rise for 1.25 s. The headline lines start at `y: 105%` and the lede at `y: 40`. A less front-loaded easing curve keeps movement perceptible across each duration.
- Use `MotionConfig reducedMotion="never"`. Do not gate the entrance, rotation or pointer tilt with `useReducedMotion()` or CSS media queries.
- Keep the orb angle in a Motion value. Advance it with `useAnimationFrame` delta only while the orb is visible, the entrance is complete and the visitor has not pressed pause. Bound delta after a suspended browser tab. A pause or viewport exit must retain the current value instead of animating to zero.
- The pause button is outside the decorative `aria-hidden` image tree. It can be used before the entrance ends; in that case the rotation does not start. Pause state is local to the current hero mount and is not stored across navigation or reloads.
- A `noscript` rule must reveal the static hero content if JavaScript is unavailable.
- Use Motion values and springs for pointer tilt. Do not update React state for every pointer movement. Pause continuous rotation outside the viewport while retaining its current angle.
- Animate only `opacity` and `transform`. Do not animate image source, filter, background position, layout dimensions or `top`/`left`.
- Do not add Three.js, Lenis, GSAP or another animation library for this phase.

## Verification criteria

1. Refreshing the page does not produce visual background blinking or a hydration warning.
2. The horizontal logo is static and the headline has visibly more space below it.
3. The circular logo is 40% smaller than the previous baseline, has no overlap with text and remains clear on large desktop monitors.
4. The sequence is clearly visible on cold load and finishes in about 2.4 seconds. It starts 350 ms after mount. It is verified through real browser screenshots or a short recording at 1440 px and 390 px, plus checks of intermediate opacity and position values at several points; checking a CSS `animation-name` is not sufficient.
5. Bulgarian and English headline lines are fully visible on desktop, laptop and mobile widths.
6. Mobile and visitors with `prefers-reduced-motion: reduce` receive the same complete entrance and rotation.
7. With JavaScript disabled, a cached hero image, or a failed hero-image request, content is readable and the page produces no hydration warning.
8. The pause button works by keyboard, has the correct BG/EN name and `aria-pressed`, and freezes the current angle. The orb keeps its angle after leaving and returning to the viewport.
9. A locale switch may remount the localized hero and replay the entrance; pause state starts unpressed on each mount.
10. Typecheck, lint, coverage, production build and focused browser checks pass.

## Out of scope

- Design or implementation of the later scroll scenes.
- Changes to final navigation, copy, services, projects, footer or asset selection.
- True 3D/WebGL rendering.

## Claude Opus 5.5 review — 30 September 2026

**Verdict of initial review:** superseded by the Motion-only revision below.

### Mobile decision resolved

The circular logo stays visible below the mobile headline. The heading takes the full available width, with only responsive page padding at both sides. The orb uses the smaller of 44vw and 18svh, with at least 1rem vertical spacing before and after it.

### Motion-only review, revision 2 — 30 September 2026

The first implementation passed state-based automated tests but failed visual verification: its decode gate could start during hydration, its movement was too small and short, and tests forced a motion preference that may not match the real browser. Opus and Codex agreed to replace the gate with declarative Motion variants, a 350-ms post-mount delay and a 2.4-second sequence; the user approved that revision.

### Consensus on the mobile orb

Opus identified a risk that a full-width, multi-line Bulgarian headline followed by an unrestricted orb can push CTAs too far down. We retain the requested visual order — headline, then orb — and address the risk with a viewport-height cap rather than moving or hiding the orb. The acceptance checks at 320 px and 375 px must confirm that headline, description and both CTAs are readable without overlap or horizontal scrolling.

### User motion decision — 30 September 2026

The user explicitly approved identical full animation for all visitors, irrespective of the operating-system motion preference. The project aims for WCAG 2.2 AA. WCAG 2.3.3 is AAA, while applicable ongoing automatic movement needs a visitor-controlled pause under 2.2.2. Motion runs with `reducedMotion="never"`; the orb has a keyboard-accessible pause/resume button and preserves its angle across pauses and viewport exits. This decision supersedes the older reduced-motion instructions above.

Opus reviewed the new decision before implementation. We adopt its Motion-value rotation, 40 px control target, fixed localized button name with `aria-pressed`, and separate decorative image tree. The user explicitly required both localized labeling and `aria-pressed`; a fixed name avoids redundant state announcements. The existing hidden-until-hydration entrance remains a known pre-existing limitation and will be handled in a separate approved change. Three.js and poster references in the older architecture are deferred proposals, not requirements for this Motion scene.

### Approved changes — 1 October 2026

The user supplied `2026_Redesign/arrow.svg` and asked to replace the hand-drawn scroll arrow with that exact vector silhouette. Its existing fill `#EC691F` is changed at render time to the current `--color-primary`, without changing the original asset. The scroll-driven left-to-down rotation and current responsive dimensions stay in place.

After the visitor pauses the orb rotation, mouse hover should produce a clearly stronger 3D tilt. The pointer range remains normalized to the stable orb entrance bounds; the paused state uses about ±17° on each axis, while the rotating state keeps its existing subtle ±7°. Changing the pause state updates the tilt at the current pointer position. This stronger pointer-initiated motion while paused is the user's deliberate choice. The tilt still springs back on pointer leave, stays decorative, and does not move nearby text or the pause button.

### Header controls — approved and implemented (1 October 2026)

**Brief.** Change the header “Да работим заедно” link to `background: none`, `border: 1px solid var(--color-primary)`, `color: var(--color-primary)`, `border-radius: .6em`, and `padding: .4em 1em`. Turn the menu control orange and give its icon the open/close animation seen on KOTA.

**Observed reference.** [KOTA](https://kota.co.uk/)'s public header CSS, inspected on 1 October 2026, renders two horizontal menu strokes separated vertically by 3 px. Opening the menu moves both to the centre and rotates them to +45° and −45°, forming an X. The strokes transition over `.3s cubic-bezier(.75, 0, .25, 1)`. No separate `:hover` animation rule was found for that icon in the inspected stylesheet. This proposal covers the icon transition only; KOTA's full-screen navigation and flyout animation are outside the requested button change.

**Implementation.** Reuse the existing `SiteHeader`, native `<details>/<summary>` control and component CSS. Remove the filled `button--orange` class from this header CTA, keep the shared `.button` base, and put the five requested declarations on `.site-header__cta`. Keep the shared `.button` minimum height of 44 px as a practical click target on every viewport: remove the existing 36 px mobile `min-height` override. The CTA has exactly `.4em 1em` CSS padding, although its minimum height can make the rendered height larger. Remove the mobile padding overrides that contradict `.4em 1em`, retain the mobile font-size overrides, and check header fit at the current responsive breakpoints. The `em` padding and radius intentionally scale with those mobile font sizes. The existing `.button--outline` cannot be reused directly because its hardcoded darker text and light hover fill conflict with the requested primary orange on the dark header. The CTA remains transparent on hover and retains the global focus ring. Give `.site-menu summary` a transparent background, the global orange token for its border and icon, and retain the existing circular shape. Render two decorative 16 × 1 px strokes with a 3 px gap instead of three. On `.site-menu[open]`, move the first by `translateY(2px) rotate(45deg)` and the second by `translateY(-2px) rotate(-45deg)`; put `transform .3s cubic-bezier(.75, 0, .25, 1)` on each stroke so opening and closing animate. A 1 px diagonal may look slightly soft at DPR 1; preserve the current icon's light weight unless visual inspection shows a problem. The menu panel, links, keyboard behaviour and localization stay as they are. Native `<details>` is not a dialog: Escape and outside click do not automatically close it. No new library or JavaScript handler is needed.

**Acceptance.** Add Playwright checks for computed CTA styles, including the five requested declarations, at least 44 px height and transparent hover, and menu colour on BG/EN pages at desktop and mobile widths. Verify exactly two strokes form an X when the menu opens and return when it closes, including Enter and Space activation; allow transitions to settle before asserting computed transforms. Check that the CTA, brand and menu still fit at 360, 390 and desktop widths, and that the CTA hides at 359 px. A visual check should confirm the open icon and focus indicator remain legible and distinct at normal and high pixel density. The site's established user decision is to show the same animation regardless of `prefers-reduced-motion`; the brief does not reopen that decision.

**Consensus after Opus review.** Opus supported reusing native `<details>` and CSS and requested explicit geometry, hover, mobile and focus criteria; those are recorded above. Its suggestion to suppress this transition under `prefers-reduced-motion` conflicts with the user's 30 September decision that animations should behave identically for all visitors, so this implementation retains that decision. Opus also suggested removing the 44 px minimum height for visual fidelity; we keep the established accessible click target because the user specified padding, not a total button height. The selected interpretation of “orange” is orange border and lines over a transparent circle, consistent with the outlined CTA. The user approved this interpretation and the icon-only KOTA scope.
