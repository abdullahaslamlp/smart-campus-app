---
name: SafePass Logistics
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
  on-surface-variant: '#43474d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#74777e'
  outline-variant: '#c4c6ce'
  surface-tint: '#49607e'
  primary: '#000f22'
  on-primary: '#ffffff'
  primary-container: '#0a2540'
  on-primary-container: '#768dad'
  inverse-primary: '#b0c8eb'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#001209'
  on-tertiary: '#ffffff'
  tertiary-container: '#002a1a'
  on-tertiary-container: '#009e6d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d2e4ff'
  primary-fixed-dim: '#b0c8eb'
  on-primary-fixed: '#001c37'
  on-primary-fixed-variant: '#314865'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-status:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 24px
  body-metadata:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 8px
  touch-target-min: 44px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
  card-gap: 12px
---

## Brand & Style
The design system is engineered for high-stakes school environments where clarity and authority are paramount. It follows a **Corporate / Modern** aesthetic, heavily influenced by the Apple Human Interface Guidelines (HIG). The UI prioritizes function over form, ensuring that dismissal staff and parents can process critical information at a glance without visual distraction. 

The emotional response is one of safety, reliability, and precision. It avoids decorative trends like glassmorphism or neon in favor of a utilitarian, institutional feel that bridges the gap between enterprise logistics and educational care.

## Colors
The palette is optimized for two distinct use cases:
- **Light Mode (Parent/Staff App):** Utilizes a "Stark White" (#FFFFFF) background to ensure maximum legibility under outdoor lighting conditions.
- **Dark Mode (Classroom/Dashboard):** Utilizes "Deep Navy" (#0A2540) to reduce eye strain in classroom settings while maintaining high contrast for status updates.

Primary Navy is used for authoritative elements, while Emerald Green and Amber act as functional status indicators for "Dismissed" and "Waiting/In-Transit" respectively. Secondary text uses Slate Gray to maintain a clear visual hierarchy between primary data and metadata.

## Typography
This design system utilizes **Inter** (as the system-equivalent for SF Pro) to maintain a systematic, utilitarian appearance. Typography is used as a functional tool: 
- **Heavy Weights (700):** Reserved for student names, lane assignments, and status updates.
- **Medium Weights (500):** Used for metadata like car make, model, or license plate info.
- **High Contrast:** All text must meet a minimum 4.5:1 contrast ratio against its background. In Dark Mode, status text should use increased font-weight to maintain visual optical weight.

## Layout & Spacing
The layout follows a **Fluid Grid** model based on an 8px rhythmic scale. 

- **Touch Targets:** A strict minimum of 44x44pt is enforced for all interactive elements to accommodate gloved hands or high-speed dismissal environments.
- **Mobile:** 4-column grid with 16px side margins. 
- **Classroom Dashboard:** 12-column grid optimized for landscape orientations, allowing for multi-column student lists.
- **Safe Areas:** Adhere to HIG safe area insets for all notch and home-indicator regions.

## Elevation & Depth
This design system uses **Tonal Layers** and **Low-Contrast Outlines** rather than heavy shadows to denote hierarchy.
- **Cards:** Defined by 1px solid borders (#E2E8F0) in light mode, or slight tonal shifts in dark mode.
- **Hierarchy:** Elements that require immediate action (like an "Arrived" prompt) may use a subtle, large-radius ambient shadow to pull the element forward.
- **Flat Depth:** Most UI elements reside on a single surface level to maintain a clean, professional "dashboard" feel.

## Shapes
The shape language is **Soft (0.25rem)**. This provides a professional, "app-like" feel without the playfulness of fully rounded corners. 
- **Status Badges:** Use a slightly higher roundedness (rounded-lg) to distinguish them from structural card elements.
- **Inputs:** Maintain the standard 0.25rem radius for a structured, form-heavy appearance.

## Components
- **Buttons:** High-contrast solid fills for primary actions. In dark mode, buttons use white or high-saturation primary colors to stand out against the Deep Navy background.
- **Status Badges:** Color-coded (Emerald/Amber/Navy) badges with bold uppercase labels. These are the primary anchors for visual scanning.
- **Dismissal Cards:** Large-format cards displaying Student Name (Headline-LG) and Car ID (Body-Metadata). Cards should feature a vertical "status stripe" on the left edge for rapid identification.
- **Swipe-to-Confirm:** A horizontal slider component for high-consequence actions (e.g., "Confirm Student Pick-up") to prevent accidental taps.
- **GPS Pulse:** A subtle concentric pulse animation for the parent's location on maps, using the primary Navy color at 20% opacity.
- **Inputs:** Clearly labeled fields with persistent placeholder text. Error states should utilize the Warning Amber color for non-critical alerts and a standard Red for system errors.