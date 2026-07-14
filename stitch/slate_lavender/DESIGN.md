---
name: Slate & Lavender
colors:
  surface: '#f9f9fb'
  surface-dim: '#dadadc'
  surface-bright: '#f9f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f3f5'
  surface-container: '#eeedf0'
  surface-container-high: '#e8e8ea'
  surface-container-highest: '#e2e2e4'
  on-surface: '#1a1c1d'
  on-surface-variant: '#43474d'
  inverse-surface: '#2f3132'
  inverse-on-surface: '#f1f0f2'
  outline: '#73777d'
  outline-variant: '#c3c7cd'
  surface-tint: '#466179'
  primary: '#466179'
  on-primary: '#ffffff'
  primary-container: '#b0cce8'
  on-primary-container: '#3c576e'
  inverse-primary: '#aecae6'
  secondary: '#416183'
  on-secondary: '#ffffff'
  secondary-container: '#b7d7ff'
  on-secondary-container: '#3e5e80'
  tertiary: '#635c64'
  on-tertiary: '#ffffff'
  tertiary-container: '#d0c6d0'
  on-tertiary-container: '#59525a'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#cce5ff'
  primary-fixed-dim: '#aecae6'
  on-primary-fixed: '#001d31'
  on-primary-fixed-variant: '#2e4960'
  secondary-fixed: '#d1e4ff'
  secondary-fixed-dim: '#a9c9f1'
  on-secondary-fixed: '#001d35'
  on-secondary-fixed-variant: '#28496a'
  tertiary-fixed: '#eadfe9'
  tertiary-fixed-dim: '#cdc4cd'
  on-tertiary-fixed: '#1f1a21'
  on-tertiary-fixed-variant: '#4b454d'
  background: '#f9f9fb'
  on-background: '#1a1c1d'
  surface-variant: '#e2e2e4'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  gutter: 16px
  margin: 24px
---

# Design System: Slate & Lavender

## Brand & Style
The brand identity is centered around a composed, professional, and sophisticated aesthetic. The style is **Corporate / Modern** with a touch of **Minimalism**. It aims to evoke a sense of reliability, calm, and clarity, moving away from high-energy tones to a focused environment where the user's content is the priority.

## Colors
The color palette is built on a foundation of soft, airy blues and muted slates, designed to be professional yet light and open.

- **Primary:** #b0cce8 (Pale Sky Blue) — A soft, inviting blue used for primary actions and key brand moments.
- **Secondary:** #83a3c9 (Steel Blue) — A deeper, more saturated blue used for supportive UI accents and functional depth.
- **Tertiary:** #8a828b (Muted Mauve) — A neutral, desaturated purple used for subtle accents and secondary highlights.
- **Neutral:** #767779 (Medium Grey) — Used for text, borders, and structural elements.

The system uses a **Light** color mode by default, emphasizing clarity and a clean workspace.

## Typography
The system utilizes **Inter** for all typographic needs. Inter is a highly legible sans-serif font designed for screens, providing a neutral and modern character.

- **Headlines:** Bold and clear hierarchy using Inter.
- **Body Text:** Optimized for readability at 14px and 16px.
- **Labels:** Small, high-contrast text for metadata and UI controls.

## Layout & Spacing
The layout follows a **fluid grid** philosophy with a base 4px rhythm. This ensures a tight, organized appearance.

- **Grid:** 12-column system for desktop, collapsing to 4 columns for mobile.
- **Gaps:** Standardized gutters of 16px maintain clear separation.
- **Margins:** 24px page margins provide consistent breathing room across devices.

## Elevation & Depth
Depth is communicated through **Tonal Layers** and subtle **Ambient Shadows**. Surfaces use slight variations in neutral tones to indicate hierarchy. Shadows are very soft with low opacity, ensuring the interface feels structured and grounded rather than cluttered.

## Shapes
The design features a **Rounded** aesthetic (Level 2), which softens the professional environment to make it more approachable.

- **Standard Radius:** 8px for buttons and inputs.
- **Container Radius:** 16px for cards and modals.

## Components
- **Buttons:** 8px rounded corners; primary buttons in Pale Sky Blue. Secondary buttons utilize Steel Blue for a more defined, functional look.
- **Cards:** 16px rounded corners with soft elevation or light borders.
- **Inputs:** 8px rounding with neutral borders, highlighting in Pale Sky Blue on interaction.
- **Chips:** Pill-shaped elements often utilizing the Muted Mauve (Tertiary) or Steel Blue (Secondary) for accents.