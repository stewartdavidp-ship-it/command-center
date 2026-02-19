# Command Center Logo Specification

## Concept: Structured Cells
Hexagonal cluster representing modular, self-contained concepts (ODRC types) that tile into a larger structure. The center hex is the crystallized insight; satellites are forming/emerging concepts at varying stages of definition.

## Visual Identity
- **Metaphor**: "Structured inspiration" — raw ideas given form
- **Shape**: Hexagonal cluster (1 center + 3 satellites)
- **Color**: Amber `#e8a838` on dark backgrounds
- **Aesthetic**: Developer-oriented, modular, warm but precise

## SVG Specification

### Structure (4 hexes)
1. **Center hex** — Full intensity `#e8a838`, elevated with drop shadow
2. **Top-right satellite** — `fill-opacity: .45`, `stroke-opacity: .65`
3. **Bottom-center satellite** — `fill-opacity: .3`, `stroke-opacity: .4`
4. **Left satellite** — `fill-opacity: .2`, `stroke-opacity: .25`

### 3D Depth Effect
- Center hex rendered ON TOP of satellites (layer order matters)
- Drop shadow on center: `dx:0.8 dy:0.8 stdDeviation:1.0 flood-opacity:.35`
- Gradient shadow in overlap zone between center and top-right hex
- Inner highlight on center: white polygon at `fill-opacity: .15`

### Scaling Rules
- Stroke width increases proportionally at smaller sizes (1.2px at 80px → 2.8px at 16px)
- At 16px: reduce to center + 1 satellite (top-right)
- At 24px: reduce to center + 2 satellites (top-right, bottom)
- At 32px+: show all 4 hexes

### Reference SVG (viewBox 0 0 52 52)
```svg
<svg width="80" height="80" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0.8" dy="0.8" stdDeviation="1.0" flood-color="#000" flood-opacity=".35"/>
    </filter>
    <linearGradient id="sh" x1="28" y1="11" x2="33" y2="19" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="60%" stop-color="#000" stop-opacity=".3"/>
      <stop offset="100%" stop-color="#000" stop-opacity=".4"/>
    </linearGradient>
  </defs>
  <!-- Satellites (behind) -->
  <polygon points="35,7 42,11 42,19 35,23 28,19 28,11" fill="#e8a838" fill-opacity=".45"/>
  <polygon points="35,7 42,11 42,19 35,23 28,19 28,11" fill="none" stroke="#e8a838" stroke-opacity=".65" stroke-width="1.2"/>
  <polygon points="26,31 33,35 33,43 26,47 19,43 19,35" fill="#e8a838" fill-opacity=".3"/>
  <polygon points="26,31 33,35 33,43 26,47 19,43 19,35" fill="none" stroke="#e8a838" stroke-opacity=".4" stroke-width="1.2"/>
  <polygon points="12,19 19,23 19,31 12,35 5,31 5,23" fill="#e8a838" fill-opacity=".2"/>
  <polygon points="12,19 19,23 19,31 12,35 5,31 5,23" fill="none" stroke="#e8a838" stroke-opacity=".25" stroke-width="1.2"/>
  <!-- Shadow in overlap zone -->
  <polygon points="28,11 33,14 33,19 28,19" fill="url(#sh)"/>
  <!-- Center hex (on top) -->
  <polygon points="26,15 33,19 33,27 26,31 19,27 19,19" fill="#e8a838" filter="url(#ds)"/>
  <!-- Inner highlight -->
  <polygon points="26,18.5 30.5,21 30.5,26 26,28.5 21.5,26 21.5,21" fill="#fff" fill-opacity=".15"/>
</svg>
```

## Usage Contexts
- **Favicon**: 16px (center + 1 satellite)
- **Nav header**: 32px (all 4 hexes)
- **App icon / PWA**: 192px, 512px (all 4 hexes, full detail)
- **Splash / about**: 80px+ (all 4 hexes with inner highlight)

## Replaces
Previously borrowed Game Shelf logo. This is CC's own purpose-built identity.
