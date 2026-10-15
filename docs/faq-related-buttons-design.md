# FAQ related links as compact buttons

## Brief

Replace the three large link cards below the FAQ questions with three compact, centered buttons. Remove each description line and the circular borders around both the leading icon and trailing arrow. Bring the arrow closer to the title. Keep the three destinations and translated titles.

## Current implementation

`components/FaqPage.tsx` renders the links in `.faq__related` as `Link` elements with an icon, title, description, and arrow. `components/FaqPage.css` sets a three-column grid of cards with a minimum height of 8.6rem, large circular icon and arrow containers, and a one-column mobile layout. The site already has reusable `.button` and `.button--outline` styles in `styles/globals.css`; the header, footer, and product pages use them.

## Proposed change

- Reuse `button button--outline` on the three existing `Link` elements, following the product-page link pattern in `components/SitePage.tsx` and `.service-detail__link` in `components/SitePage.css`. Render only the leading `RelatedIcon` SVG, translated title span, and trailing `ArrowIcon` SVG; remove their circle wrappers and the description from visible markup. Keep descriptions in translation data as unused copy for a possible future layout; they do not affect rendered output.
- In the existing FAQ CSS, replace the related-links grid with a centered, wrapping flex row and a responsive gap. At widths up to 47.5rem, use a centered column with content-width buttons; different button widths are acceptable because their centers align. Let the global button style own border, radius, typography, minimum height, and hover behavior. Its slightly smaller 0.9rem bold title and orange text/icons, turning lime on hover, are intended.
- Scope only internal sizing and spacing to FAQ with a selector such as `.faq__related .button`, strong enough to override the global `.button` gap regardless of CSS import order. Use approximately `.5em` internal gap, 1.25rem leading SVG and a slightly smaller trailing arrow. Set `max-width: 100%` on links and `white-space: normal` on the title span so future longer copy can wrap without horizontal overflow. Remove obsolete card styles in `components/FaqPage.css` (current lines 37-45), tablet overrides (68-71), mobile minimum height (88), and forced-colors references to the old card and description (97-98). Do not add a new shared button variant.
- Preserve all three current destinations, keyboard focus behavior, and navigation semantics. Do not alter the questions, FAQ cards, or pending card-opening animation proposal.

## Verification

- At desktop, tablet, and mobile widths, show exactly three compact buttons centered beneath the questions, with clear space between them and no horizontal overflow. On mobile they form a centered column.
- Confirm each button displays one title line where space allows, no description line, no circular icon or arrow border, and a nearby arrow.
- Confirm all three hrefs are unchanged, the accessible name is the title alone, and icons remain `aria-hidden`. Check that orange text and the focus ring remain visible over the FAQ photo and shade, including on hover. The existing frontend test already checks hrefs; extend it to confirm descriptions are absent from rendered output. Add a narrow-screen browser check for centered buttons and no horizontal overflow. Run the existing FAQ browser tests, build, and lint, then inspect desktop and mobile layouts visually.

## Review and decision

Claude Opus reviewed this document on 2026-10-15. It agreed with reusing the global outline button and preserving destinations, and identified stale CSS, mobile wrapping, potential overflow from `white-space: nowrap`, and focus/contrast checks. We choose a centered mobile column with content-width buttons, title wrapping if needed, direct SVG icons without circular wrappers, and explicit removal of the old card-specific CSS. We keep unused description strings in data because the user asked to remove the visible second line; deleting translations is unnecessary for the layout. The existing product link provides the size and gap precedent. The user explicitly directed us to use the previously approved standard button on 2026-10-15; this approves implementation of this reviewed plan.
