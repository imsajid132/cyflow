# Bundled poster fonts

The poster renderer ships these faces instead of assuming the host has any.

A production render came back with every glyph as a missing-character box: the
host has no system fonts at all, so nothing matched and resvg drew tofu. The
poster was unreadable while the copy beside it was perfect — a failure that looks
like a design bug and is really a missing dependency.

- `Inter-Regular.ttf` — variable sans, weights 100-900
- `PlayfairDisplay.ttf` — variable serif, weights 400-900

Both are licensed under the SIL Open Font License 1.1 (see `OFL.txt`), which
permits redistribution with the software.

`src/services/aiStudio/posterRenderer.js` points resvg at this directory, and the
SVG design prompt is told these are the ONLY two families available — naming any
other one would bring the boxes back.
