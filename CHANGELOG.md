# Changelog

The release workflow uses the section named after the version being released
as the release description, so every version needs one. `npm version <x.y.z>`
renames the `Unreleased` heading below to that version.

## 0.1.0

- First release: a live, clickable table of contents in any note from a `toc` code block.
- Also renders `table-of-contents` blocks, with the options Automatic Table of Contents uses.
- Collapse the block or a single branch, highlight of the section you are reading, click or Ctrl/Cmd-click to a new tab, page preview on hover.
- Plain Markdown tables of contents between comment markers, refreshed on demand or two seconds after a heading changes, never after an undo.
- Links that land on the right heading even when names repeat.
- Commands to insert, refresh, switch between live and Markdown, list only a section, adopt an existing list and copy the list as Markdown.
