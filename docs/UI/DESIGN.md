# Design System Specification: The Chromatic Intelligence

## 1. Overview & Creative North Star
### Creative North Star: "The Editorial Analyst"
This design system moves away from the sterile, "default" appearance of standard dashboards. It is built upon the concept of **The Editorial Analyst**—a visual language that treats complex data with the prestige of a high-end financial journal. 

By leveraging the vibrant energy of `#d82c65` against a sophisticated architectural backdrop of cool grays and teals, we create an experience that is both authoritative and modern. The system breaks the traditional "box-and-line" grid by using **intentional asymmetry**, wide typographic scales, and **tonal layering**. This is not just a UI; it is a curated data narrative where white space acts as a structural element rather than a void.

---

## 2. Colors
The palette is engineered for extreme data density without sacrificing elegance.

### Primary & Brand Personality
- **Primary (`#b5044d`) & Primary Container (`#d82c65`):** The vibrant heart of the system. Used for key data insights, "active" states, and primary CTAs.
- **Secondary (`#2a6676`):** A sophisticated teal used to ground the primary pink, providing professional contrast in multi-series charts.

### The "No-Line" Rule
To achieve a premium feel, **1px solid borders for sectioning are strictly prohibited.** Boundaries must be defined through:
- **Background Color Shifts:** Use `surface-container-low` for secondary sections sitting on a `surface` background.
- **Negative Space:** Rely on the Spacing Scale (e.g., `spacing-8` or `spacing-10`) to create clear content groupings.

### Surface Hierarchy & Nesting
Think of the UI as physical layers of fine paper.
- **Base:** `surface` (`#f6f9ff`)
- **Lowest Tier:** `surface-container-lowest` (`#ffffff`) for elevated floating cards.
- **Mid-Tier:** `surface-container` (`#e3effd`) for sidebar or navigation backgrounds.
- **Highest Tier:** `surface-container-highest` (`#d7e4f1`) for inner interactive components like search bars within a card.

### Signature Textures & Glassmorphism
- **Hero CTA:** Transition from `primary` to `primary_container` via a 135-degree linear gradient.
- **Glass Overlays:** For floating modals or filters, use `surface_container_lowest` at 80% opacity with a `backdrop-filter: blur(12px)`.

---

## 3. Typography
We use a dual-typeface strategy to balance editorial sophistication with technical readability.

*   **Display & Headlines (Manrope):** A modern geometric sans-serif that feels expansive. Used for large data callouts and section headers.
*   **Body & Labels (Inter):** A workhorse typeface optimized for small-scale readability in dense data tables and tooltips.

**Key Scales:**
- **Display-LG (3.5rem):** Reserved for "Hero" metrics—the single most important number on a dashboard.
- **Headline-SM (1.5rem):** Used for card titles.
- **Label-SM (0.6875rem):** Used for chart axes and metadata, always in `on-surface-variant` to maintain hierarchy.

---

## 4. Elevation & Depth
This system eschews heavy shadows in favor of **Tonal Layering**.

- **The Layering Principle:** Place a `surface-container-lowest` card on a `surface-container-low` section. This subtle change in hex value creates a "natural lift" that feels architectural rather than digital.
- **Ambient Shadows:** Only used for components that truly "float" (like dropdowns or tooltips). Use `on-surface` color at 4% opacity with a `24px` blur and `8px` Y-offset.
- **The "Ghost Border" Fallback:** If a chart requires a container boundary for accessibility, use `outline-variant` at 15% opacity. High-contrast, opaque borders are forbidden.

---

## 5. Components

### Data Visualization (Core)
- **Palette Rotation:** For 120-color complexity, cycle through the primary (`#d82c65`), secondary (`#2a6676`), and tertiary (`#4e5d67`) ranges. Use monochromatic steps within each hue to show sub-categories.
- **Dividers:** Forbid the use of horizontal lines. Use `spacing-5` (1.1rem) to separate list items.

### Buttons
- **Primary:** Gradient fill (`primary` to `primary-container`) with `on-primary` text. Border-radius: `md` (0.375rem).
- **Secondary:** Surface-tinted. No border. Fill: `secondary-container`. Text: `on-secondary-container`.

### Cards
- **Construction:** No border. Background: `surface-container-lowest`. 
- **Padding:** Use `spacing-6` (1.3rem) for internal breathing room.

### Input Fields
- **Style:** Use "Soft Fill" instead of outlined. Background: `surface-variant`. On focus, transition background to `surface-container-lowest` with a "Ghost Border" of `primary` at 20%.

---

## 6. Do’s and Don’ts

### Do:
- **Use "Signature" Asymmetry:** Align headline text to the left while keeping data metrics flush right to create a professional, editorial rhythm.
- **Prioritize Tonal Shifts:** Always ask "Can I define this area with a subtle background color change?" before reaching for a border.
- **Leverage Soft Pink Accents:** Use `primary-fixed` (`#ffd9df`) for background highlights on text to draw the eye without the aggression of a full brand pink.

### Don’t:
- **Don’t use 100% Black:** For text, use `on-surface` (`#111d26`). For shadows, use a tinted variant. Pure black breaks the "Editorial" softness.
- **Don’t Over-Round:** Stick to the `md` (0.375rem) or `lg` (0.5rem) roundedness scale. Avoid `full` (pill-shape) for anything other than small chips or tags.
- **Don’t use Standard Shadows:** Avoid "drop shadows" that look like they belong in a 2010 UI. If it doesn't look like ambient light, it's too heavy.