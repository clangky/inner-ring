# The Inner Ring — Status

*Updated: 2026-09-27*

## Current state

The first complete implementation is public and live at
<https://clangky.github.io/inner-ring/>. Source is available at
<https://github.com/clangky/inner-ring>. The application is a first-person
Three.js experience inside a shader-deformed toroidal channel.

Implemented controls cover observer position, spine/posture, exterior pressure,
gear-tooth density, turning speed, pause, reset, free gaze, and a temporary
pressure pulse. The interface supports mouse, wheel, keyboard, pointer/touch,
small screens, and reduced-motion preferences.

## Validation

- `npm run build` passes.
- `npm audit` reports no known vulnerabilities.
- A scoped secret scan found no credentials or private material.
- GitHub Pages deployed successfully from the `main` branch through Actions.
- The public document and production assets return HTTP 200.
- Live browser acceptance passed at desktop and mobile sizes.
- Center, anterior membrane, and posterior membrane states were visually
  checked; position, spine, pressure, tooth density, pause/resume, pressure
  pulse, and reset were exercised successfully.
- The acceptance pass caught an interior-wall culling defect and an oversized
  near-camera particle; both were corrected in commit `f874a35` and verified
  after redeployment.

## Next step

Merl should make the first experiential review from the live site. Refine the
spatial interpretation from that reaction rather than adding features
speculatively.
