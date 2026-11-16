# Decisions

- Atmungsraum's existing static HTML, CSS and Pretext 0.0.9 provide the design
  baseline. The mock controller is separate from the shared presentation files.
- Simulated ECG uses the original 30-minute NeuroKit2 ECGSYN trace. Page-clock
  packet timing, signal gaps and loss exercise the same display code.
- The new GitHub repository hosts the public Pages playground from `main:/`.
  Test values stay in the page. Fixture CSV downloads use a fixed demo identity.
- UI changes can be ported from the tagged playground baseline. The mock device
  state stays in the playground.
