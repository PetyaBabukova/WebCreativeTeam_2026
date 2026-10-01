# Intro section design — proposed for approval

**Date:** 1 October 2026  
**Status:** Design proposal. No implementation is authorized yet.  
**References:** user-provided BG/EN copy and `2026_Redesign/Assets/intro section_BG.png` / `intro section_EN.png` (1672 × 940/941 px desktop mockups).

## Goal and visual composition

The intro follows the current hero in normal document flow. On scroll, the hero's text, orb and arrow move upward; the intro enters over the **same stationary desktop/mobile background**. The background image and its shade never translate, scale, fade, switch at the section boundary, or reload. There is no second full-screen background or scroll interception. The fixed header CTA and menu remain above both scenes; the footer covers the fixed art as it does today.

The reference is a composition guide, not an image to display as a whole. Both supplied PNGs contain flattened text and cards. Render all copy, numbers/icons, separators and cards as real HTML/CSS for localization, responsive layout, selectable text, accessibility and SEO. Keep the source PNGs as visual references; do not duplicate their text in an `<img>` or add them to the page payload. Reuse the existing hero background assets, Sofia Sans, container/gutter and color tokens.

Desktop composition: a broad headline on the left, the explanatory paragraph on the right, and a row of three equal-height glass-like cards underneath. The third headline line carries the mint-to-orange gradient. The first two lines are regular white in BG and bold white in EN, following the two mockups. Each card has a small top marker (BG: eye, four-point sparkle, rising arrow; EN: `01 —`, `02 —`, `03 —`), title, bold proposition, short accent rule and body text. BG card titles use the gradient; EN titles are white. Decorative multiplication signs sit between cards without covering their borders or text. No card is a link until a destination is specified.

The screenshots show slightly different type and icon treatments between languages; retain those deliberate locale differences. The exact card border curvature, transparency and spacing should be tuned against the supplied reference at 1672 × 940 without treating screenshot pixels as fixed CSS coordinates. The existing fixed background's crop changes with viewport size; do not promise exact light-trail placement at every width. A dark translucent card fill, light border and subtle green/orange edge can evoke the glass treatment. Prefer this over large `backdrop-filter` regions, which are costly over a fixed detailed image; a bounded blur may be considered only if a visual check shows it is needed and remains smooth on a mid-range phone.

## Approved text to preserve

**BG heading:** “Да бъдеш онлайн” / “не е целта.” / “Да имаш значение — е.”  
**BG introduction:** “Успешните брандове не разглеждат маркетинга, технологиите и дизайна поотделно. Те ги превръщат в свързана система, в която всяка част подсилва останалите.”

| BG card | Proposition | Body |
| --- | --- | --- |
| ВИДИМОСТ | Правилната аудитория. Правилният момент. | Стратегическа видимост в търсачките, AI средата и ключовите дигитални канали. |
| ПРЕЖИВЯВАНЕ | Присъствие, което оставя следа. | Бранд и уеб преживяване с ясна идентичност, силно присъствие и причина да бъде избрано. |
| РАЗВИТИЕ | Технология, която движи бизнеса. | Автоматизация, оптимизация и дигитални решения, които ускоряват процесите и създават основа за устойчив растеж. |

**EN heading:** “Being online” / “isn't the goal.” / “Making an impact is.”  
**EN introduction:** “Successful brands don't treat marketing, technology, and design as separate disciplines. They bring them together into one connected system, where every part strengthens the others.”

| EN card | Proposition | Body |
| --- | --- | --- |
| VISIBILITY | The right audience. The right moment. | Strategic visibility across search, AI-powered discovery, and the digital channels that matter. |
| EXPERIENCE | A presence that leaves a mark. | Brand and web experiences with a clear identity, a distinctive presence, and a compelling reason to be chosen. |
| MOMENTUM | Technology that moves business forward. | Automation, optimisation, and digital solutions that accelerate processes and create a foundation for sustainable growth. |

## Structure and responsive layout

Move ownership of the existing `.hero__stage` to a shared home-scene backdrop under both hero and intro, with one fixed `<picture>` and shade. Keep semantic `<section>` elements for hero and intro as siblings under the existing home `<main>`. The backdrop is decorative and `aria-hidden`; the content sections remain above it in one stacking context. Check clipping and stacking against `.hero { overflow: clip; isolation: isolate; }`, `.site-page { overflow: clip; }`, the fixed header actions and the footer before choosing final selectors. Do not add a duplicate background source or a new image loader. The desktop first hero scene must still fit as it currently does.

The intro gets an `h2`, the explanatory paragraph, and a semantic list of three factors with `h3` card headings. The multiplication marks are decorative (`aria-hidden`); the paragraph already states that the three disciplines form one connected system. Icons are simple inline vectors (or existing matching icons if present), decorative and hidden from assistive technology. Keep title and paragraph widths independent so BG and EN wraps can differ without fragile manual line breaks. On desktop, the intended three headline phrases form three lines; on narrow screens a phrase may wrap naturally rather than overflow or shrink to illegibility.

At tablet widths, let the heading and paragraph stack or occupy a less asymmetric grid, and allow cards to wrap only when each can retain readable text width. On mobile, use a single column: heading, paragraph, then three full-width cards with the `×` marks between cards. Keep the mobile background visible around the content and card surfaces readable over its brighter areas. No horizontal scrolling, cut-off headings, offscreen decorative marks, or fixed-height cards. Use content-driven section height and generous vertical spacing rather than forcing the 940 px desktop mockup into one mobile viewport.

Store the exact user-approved copy in the existing `messages/bg.json` and `messages/en.json` under a new `landing.intro` group. Preserve punctuation and the chosen English wording, including “Making an impact is.”, “AI-powered discovery” and British “optimisation”. Do not reuse the old `landing.services` text because it describes a different section. Existing global tokens own shared colors and typography; intro-specific geometry and card treatment belong in the existing `components/SitePage.css`. Extend `components/SitePage.tsx` for the semantic section; add a small client boundary only if scroll reveal requires it, reusing the installed `motion` package. Do not grow `HeroOrb.tsx` into a general page container for unrelated intro content.

## Scroll reveal

The intro moves with native page scrolling. As its heading area enters the viewport, reveal the heading and paragraph with a modest opacity/vertical-translate transition, then reveal the three cards with a short stagger. Suggested starting values for visual tuning: 24–40 px translation, 0.55–0.8 s duration, about 0.1 s card stagger, triggered when roughly 15–25% of the intro content enters view. Apply Motion only to opacity and transform on foreground wrappers; the background and section dimensions stay static. Avoid pinning, scroll-jacking, background animation, long blank delays, and persistent card motion. The content should be present in server HTML and occupy final layout space before animation, preventing layout shifts.

The first entrance runs once during normal browsing; after it has appeared, scrolling back simply reveals the same content through native scrolling. This prevents repeated fades during small scroll adjustments. If the page loads directly at the intro scroll position, reveal it promptly. Keep readable content visible if JavaScript is unavailable or hydration is delayed. The current user decision is that the same entrance runs regardless of `prefers-reduced-motion`; these finite transitions need no pause button. Do not alter the hero orb's existing visitor-controlled pause or arrow rotation.

## Validation and boundaries

- Compare BG/EN at 390 px mobile, around 600–760 px tablet, 1280 × 720 and 1536 × 730 laptops, and 1672 × 940 / wide desktops. Verify all provided copy, line wrapping, card order, markers, multiplication signs, and contrast over both background crops.
- Verify the hero-to-intro boundary by scrolling in both directions: the same background remains fixed with no flash, duplicate image, seam or shade change; foreground sections move naturally; header controls remain reachable; footer covers the backdrop.
- Verify intro content is in server HTML, visible without JavaScript, and neither missing nor mismatched during hydration. Check keyboard reading order and that decorative icons/signs are silent to screen readers.
- Check reveal visibility when entering from above, loading at a deep scroll position, and returning upward. Confirm no horizontal overflow, layout shift, content hidden behind cards, or broken text when fonts load.
- Compare production asset sizes and a mid-range mobile scroll trace before adding any blur; keep the two flattened mockups out of the runtime bundle. No new paid tool or animation dependency is required.

**Out of scope:** implementation before user approval, detailed animation design for later sections, new destinations for the cards, changes to the existing hero copy or footer, and replacing the shared background image.

## Opus review and consensus

Pending external review. Findings and decisions will be recorded here before asking the user to approve implementation.
