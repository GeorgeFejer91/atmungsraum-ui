# Project contract

## Purpose

Provide a stand-alone smartphone UI playground for Atmungsraum, with a stable
synthetic ECG feed and reproducible operator screens for design refinement.

## Active checklist

- [x] Pin the existing German UI and keep the HTML IDs, CSS and shared renderers.
- [x] Implement mock pairing, control ownership, participant form, Polar and ECG,
  breathing setup, session controls, kiosk status and synthetic downloads.
- [x] Reuse the original seeded NeuroKit2 fixture with a hash check.
- [x] Verify the complete browser flow and the responsive layout matrix.
- [x] Verify the exact GitHub Pages deployment.
- [ ] Meet the single-viewport contract before the next feature push. The
  strict browser gate now checks the contract. Chrome emulation found document
  overflow on the participant, breathing, and session screens and internal
  overflow in both dialogs. Close this item when the
  [smartphone GUI release gate](./VERIFICATION.md#smartphone-gui-release-gate)
  passes.

## Smartphone GUI design rules

1. Treat every active screen, form, expanded state, dialog, and overlay as a
   single smartphone viewport. Fit every field, label, status, action, and
   focus indicator for that state inside the usable visual viewport. Account
   for safe areas, browser chrome, and the on-screen keyboard during input.
2. The document and every app-authored region must have zero horizontal and
   vertical scroll range. Fit must hold while navigating, editing, opening a
   dialog, and moving focus. Keep user zoom and text enlargement available.
   Clipped content, hidden scrollbar chrome, and scrolling to reach a control
   each fail the contract.
3. Use `uncodixfy-pretext` and its outside-in accordion stretch layout for all
   app screens and dialogs. Allocate the usable shell first, reserve header
   and action anchors, and keep label-field pairs and control groups in reading
   and focus order. Distribute surplus space between groups and cells along
   both axes with shrinkable Grid or Flex tracks. Derive spacing and preferred
   type from width and height while preserving readable type, visible focus,
   and usable touch targets.
4. Use the locked `@chenglou/pretext` dependency through the existing
   measurement owner. Measure every bounded text region against its actual
   inner width and height with matching loaded fonts, spacing, and locale.
   Confirm the painted result. When a state exceeds the available space,
   rearrange its groups or divide the task into explicit one-viewport steps,
   pages, or detail views with reachable navigation and preserved input.
   Each resulting view must fit with full readable text and controls.

## Ownership

Static HTML/CSS and JavaScript at the repository root. `app.js` owns
Pretext measurement. `playground.js` owns in-page mock UI state.
`simulation.js` maps the fixture to display inputs and synthetic CSV.
There is no native, browser-to-device or cloud transport. Keep fixture inputs
ephemeral and synthetic. See [README](../README.md) for transferring design
changes to the original app.

Upstream visuals are pinned to `3f8d7c8befa3c13d1e8f574e82082468ba5128f7`.
The ECG binary and generator come from the original Atmungsraum work at
`1a8057234a69bbfec40ca937983f036b7d8df5e0`. The manifest records the seed,
versions and checksum. No ECG data was acquired from a person.

The `ui-playground-baseline` tag names the first release at `4283741`.
[Pages run 43866774013](https://github.com/GeorgeFejer91/atmungsraum-ui/actions/runs/43866774013)
deployed that exact commit from `main`. Fifteen public files matched Git.
All three Node tests passed locally. The Chrome flow and seven-screen layout
matrix passed locally and on Pages at 320px, 200% text, narrow landscape,
custom text spacing, and desktop size. Checks used synthetic state and files.

The first playground milestone is complete. For the next design refinement,
use the baseline tag and port only the intended presentation changes.
Physical-phone installation and production hardware acceptance are separate.
