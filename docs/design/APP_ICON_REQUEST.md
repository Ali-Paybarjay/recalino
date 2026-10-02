# Recalino — App icon request (design round 2)

> **Delivered 2026-10-01:** [handoff-r2-icons/](handoff-r2-icons/HANDOFF.md), section 5c. Used as delivered.

Paste the text below into the same Claude Design project that made round 1.

---

Hi! Round 1 of the Recalino handoff is now being implemented. One asset is missing: **the app icon**. Please design only the app icon set. Don't change anything else in the package.

**Why we need it:** Recalino is a PWA. Learners install it on their phone's home screen, so it needs install icons and a favicon.

**Design rules:**

- Base it on what we already have: the "recalino" wordmark and the 1c "Mint & lime" palette in `recalino/tokens.css`.
- Use only colours from `tokens.css`. If you use a letterform, convert it to outlines (no fonts).
- It must stay clear at 16 px (browser tab) and look good at 512 px.
- It must work on light and dark home screens.
- Keep it simple and calm, in the same spirit as the rest of the design.

**Please deliver:**

1. A master SVG on a 512 × 512 artboard.
2. PNG files:
   - 192 × 192 and 512 × 512 (purpose "any")
   - 192 × 192 and 512 × 512 **maskable**: all important parts inside the central safe zone (a circle with a diameter of 80% of the icon)
   - 180 × 180 Apple touch icon, with no transparency (iOS rounds the corners itself)
3. A favicon: an SVG favicon and a 32 × 32 PNG.
4. The colours for the web app manifest, named as tokens: `theme_color` and `background_color`. If light and dark need different values, give both.

**How to deliver:** add the files under `recalino/icons/` in the handoff package. Add a short section to `HANDOFF.md` that says which file is for what, and which tokens the manifest uses.

Thank you!
