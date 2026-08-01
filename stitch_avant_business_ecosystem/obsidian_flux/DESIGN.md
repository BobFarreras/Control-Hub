---
name: Obsidian Flux
colors:
  surface: '#10131a'
  surface-dim: '#10131a'
  surface-bright: '#363940'
  surface-container-lowest: '#0b0e14'
  surface-container-low: '#191c22'
  surface-container: '#1d2026'
  surface-container-high: '#272a31'
  surface-container-highest: '#32353c'
  on-surface: '#e1e2eb'
  on-surface-variant: '#bac9cd'
  inverse-surface: '#e1e2eb'
  inverse-on-surface: '#2e3037'
  outline: '#859397'
  outline-variant: '#3b494c'
  surface-tint: '#00daf8'
  primary: '#baf2ff'
  on-primary: '#00363f'
  primary-container: '#00e0ff'
  on-primary-container: '#005f6d'
  inverse-primary: '#006877'
  secondary: '#b7c4ff'
  on-secondary: '#002682'
  secondary-container: '#0052fe'
  on-secondary-container: '#dfe3ff'
  tertiary: '#efe4ff'
  on-tertiary: '#3c0090'
  tertiary-container: '#d6c3ff'
  on-tertiary-container: '#6900f1'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#a5eeff'
  primary-fixed-dim: '#00daf8'
  on-primary-fixed: '#001f25'
  on-primary-fixed-variant: '#004e5a'
  secondary-fixed: '#dde1ff'
  secondary-fixed-dim: '#b7c4ff'
  on-secondary-fixed: '#001452'
  on-secondary-fixed-variant: '#0038b6'
  tertiary-fixed: '#e9ddff'
  tertiary-fixed-dim: '#d1bcff'
  on-tertiary-fixed: '#23005b'
  on-tertiary-fixed-variant: '#5700c9'
  background: '#10131a'
  on-background: '#e1e2eb'
  surface-variant: '#32353c'
typography:
  display-xl:
    fontFamily: Hanken Grotesk
    fontSize: 64px
    fontWeight: '800'
    lineHeight: '1.1'
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 28px
    fontWeight: '700'
    lineHeight: '1.2'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0.01em
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.5'
    letterSpacing: 0em
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.1em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 24px
  margin-edge: 40px
  sidebar-width: 280px
  panel-gap: 12px
---

## Brand & Style

The design system is a "Cyber-professional" framework tailored for high-stakes technical environments. It rejects the soft, rounded aesthetic of consumer SaaS in favor of a precision-engineered, high-performance interface. The personality is powerful, technical, and high-end, aimed at users who demand density without clutter.

The aesthetic fuses **Glassmorphism** with **Neo-Brutalism** elements—utilizing frosted translucent layers and subtle neon gradients to imply depth, while maintaining structural integrity through razor-sharp alignment. The interface should evoke the feeling of a glass cockpit: a sophisticated, data-rich environment that remains legible under intense operation.

## Colors

This design system defaults to a **Deep Obsidian** dark mode to maximize the impact of luminous accents. The palette relies on "Luminescent Layers" rather than flat fills.

- **Primary (Neon Cyan):** Used for critical actions, health status (optimal), and high-priority data points.
- **Secondary (Electric Blue):** Used for interactive states, primary branding, and progress indicators.
- **Accent (Cyber Purple):** Reserved for specialized technical functions, such as API triggers or encryption states.
- **Surface Strategy:** Backgrounds utilize `#0B0E14`. Overlays use semi-transparent variants of the neutral palette to create the glass effect, allowing background blurs (20px to 40px) to pull through hints of underlying gradients.

## Typography

The typographic hierarchy distinguishes between "Interface Narrative" and "Technical Truth."

- **Headlines:** Use **Hanken Grotesk** with tight tracking and heavy weights. This creates a bold, architectural feel for page titles and section headers.
- **Body:** **Inter** provides maximum legibility for documentation and descriptions, ensuring the UI remains professional and readable.
- **Data & Metadata:** All system outputs, IDs, VPS metrics, and status labels use **JetBrains Mono**. This reinforces the technical nature of the platform and ensures tabular data aligns perfectly.

## Layout & Spacing

This design system employs an **Asymmetric Mesh Grid**. Rather than a standard 12-column layout, it utilizes a fixed sidebar integrated into a "Command Mesh" that floats 12px from the screen edges.

- **The Mesh:** Layouts are composed of modular panels with a consistent 12px gap.
- **Density:** High information density is preferred. Use a 4px base unit for internal component padding.
- **Responsiveness:** On tablet/mobile, the "Command Mesh" collapses into a bottom-anchored glass dock. Side-integrated navigation transforms into a full-screen blurred overlay.
- **Margins:** Large outer margins (40px) create a "floating" effect for the entire application interface against the obsidian backdrop.

## Elevation & Depth

Elevation is achieved through **Luminance and Refraction** rather than traditional drop shadows.

- **Level 0 (Base):** Deep Obsidian (#0B0E14).
- **Level 1 (Panels):** Surface at 60% opacity with a 32px backdrop blur. Borders are 1px solid white at 10% opacity (Inner Glow).
- **Level 2 (Active/Modals):** Surface at 80% opacity with a 1px primary-color stroke at 30% opacity.
- **Neon Accents:** Use a 15px outer "Glow" (Box Shadow: 0 0 15px primary) for active status indicators and critical primary buttons to simulate light emission.

## Shapes

The shape language is **Technical-Geometric**. We use "Soft" roundedness (4px) to avoid the aggression of sharp corners while maintaining a professional, rigid structure.

- **Containers:** Standard panels use `rounded-md` (4px).
- **Interactive Elements:** Buttons and Inputs follow the same 4px rule.
- **Strictness:** Avoid pill-shaped elements entirely, except for very small status pips. This maintains the "Cyber-professional" rigidity.

## Components

- **Glass Cards:** Feature a top-left subtle gradient "sheen" and a 1px border. Backgrounds must use `backdrop-filter: blur(24px)`.
- **Primary Buttons:** High-contrast Neon Cyan fills with black text. On hover, they emit a cyan glow.
- **Technical Inputs:** Monospaced text entry with a 1px bottom border that glows electric blue when focused.
- **Health Status:** Small, square indicators. "Healthy" is a pulsing Neon Cyan; "Error" is a static, sharp Neon Red.
- **Navigation (Side-Integrated Mesh):** A vertical rail that is partially transparent, utilizing blurred backgrounds to show hints of content scrolling beneath it.
- **Data Visualization:** Line charts use "Glow Strokes"—semi-transparent paths with a bright leading edge.