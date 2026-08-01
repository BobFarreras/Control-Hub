---
name: Luminous Precision
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#494454'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#7b7486'
  outline-variant: '#cbc3d7'
  surface-tint: '#6d3bd7'
  primary: '#6b38d4'
  on-primary: '#ffffff'
  primary-container: '#8455ef'
  on-primary-container: '#fffbff'
  inverse-primary: '#d0bcff'
  secondary: '#00687a'
  on-secondary: '#ffffff'
  secondary-container: '#57dffe'
  on-secondary-container: '#006172'
  tertiary: '#855000'
  on-tertiary: '#ffffff'
  tertiary-container: '#a76500'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e9ddff'
  primary-fixed-dim: '#d0bcff'
  on-primary-fixed: '#23005c'
  on-primary-fixed-variant: '#5516be'
  secondary-fixed: '#acedff'
  secondary-fixed-dim: '#4cd7f6'
  on-secondary-fixed: '#001f26'
  on-secondary-fixed-variant: '#004e5c'
  tertiary-fixed: '#ffdcbb'
  tertiary-fixed-dim: '#ffb869'
  on-tertiary-fixed: '#2c1700'
  on-tertiary-fixed-variant: '#673d00'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  mono-data:
    fontFamily: jetbrainsMono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1440px
  gutter: 24px
  margin-desktop: 40px
  margin-mobile: 16px
---

## Brand & Style
The design system is centered on the concept of "Luminous Precision." It targets power users who demand technical depth without the visual clutter of traditional enterprise dashboards. The aesthetic is a fusion of **Minimalism** and **Glassmorphism**, emphasizing high-end clarity through ultra-clean white surfaces and light-refracting layers.

The UI should evoke a sense of calm authority—sophisticated, technical, and fresh. It moves away from standard SaaS patterns by eliminating heavy borders in favor of subtle depth, airy margins, and vibrant, purposeful accents that guide the eye toward critical data.

## Colors
The palette is dominated by a "Super White" foundation to maximize the sense of luminosity.

- **Primary (Electric Violet):** Used for primary actions, active states, and critical path highlights.
- **Secondary (Cyber Teal):** Reserved for data visualizations, secondary status indicators, and success states.
- **Neutral Surface:** A very soft slate-tinted white (#F8FAFC) used for background regions to make the white "Floating Glass" components pop.
- **Typography:** Deep slate tones are used instead of pure black to maintain a high-end, softer contrast that reduces eye strain while remaining crisp.

## Typography
This design system utilizes **Hanken Grotesk** for its sharp, contemporary geometry and exceptional legibility at small sizes.

- **Headlines:** Use tighter letter spacing and semi-bold weights to create a sense of structural precision.
- **Labels:** Small labels use uppercase with increased tracking to differentiate functional metadata from narrative content.
- **Data Points:** For experimental visualizations and technical values, JetBrains Mono is permitted as a secondary font to emphasize the "Control Hub" utility.

## Layout & Spacing
The layout follows a **Fluid Grid** model with generous white space to prevent information density from feeling overwhelming.

- **Grid:** A 12-column system is used for desktop, 8-column for tablet, and 4-column for mobile.
- **Rhythm:** All spacing is based on an 8px base unit.
- **Containment:** Use exaggerated inner padding (32px+) within cards to reinforce the "Luminous" feel.
- **Desktop Strategy:** Content is centered in a max-width container, while background blurs and secondary navigation elements may bleed to the edges of the viewport to create an expansive, high-end feel.

## Elevation & Depth
Depth is achieved through **Tonal Layering** and **Ambient Shadows** rather than lines.

- **Level 0 (Background):** Neutral Surface (#F8FAFC).
- **Level 1 (Floating Glass):** Pure White (#FFFFFF) with a 20px background blur (backdrop-filter) and a soft, multi-layered shadow. The shadow should be ultra-diffused: `0 10px 30px rgba(0, 0, 0, 0.04)`.
- **Level 2 (Interactive):** When hovered, cards should lift slightly using a more pronounced shadow: `0 20px 40px rgba(139, 92, 246, 0.08)`.
- **Borders:** Avoid solid borders. Use a 1px semi-transparent white highlight on the top edge of cards to simulate a light source reflecting on glass.

## Shapes
The shape language is controlled and modern. A standard `0.5rem` (8px) radius is used for interactive elements like buttons and inputs, while larger containers (cards) use `1rem` (16px) to soften the technical edge. This creates a balance between "Precision" (sharp content) and "Approachability" (rounded containers).

## Components
- **Floating Glass Cards:** The primary container. Must have white backgrounds with 80-90% opacity if placed over colored elements, paired with backdrop-blur. No borders.
- **Action Buttons:**
    - *Primary:* Electric Violet fill with white text. High-contrast shadow on hover.
    - *Ghost:* No background, Cyber Teal text. On hover, a soft 5% teal tint appears.
- **Inputs:** Ultra-minimal. Only a bottom highlight (2px) in Cyber Teal when focused. The input field itself is a slightly cooler white.
- **Experimental Data Viz:** Graphs should use gradient strokes (Electric Violet to Cyber Teal). Points on a chart should glow slightly using a soft outer bloom.
- **Chips:** Small, pill-shaped markers with 10% opacity fills of the accent colors and 100% opacity text for high legibility.
- **Micro-interactions:** All hover states should use a 200ms ease-out transition. Elements should "float" (translate -4px on Y-axis) when engaged.