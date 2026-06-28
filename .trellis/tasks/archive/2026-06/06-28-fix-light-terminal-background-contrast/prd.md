# Fix Light Terminal Background Contrast

## Goal

Fix issue #64 where Codex output becomes too faint in the built-in terminal when the app uses a light theme, especially after the terminal background image feature is enabled.

## User Value

Users should be able to read Codex and other CLI output clearly in light themes, with or without a terminal background image.

## Confirmed Facts

- The terminal is rendered by `XTermTerminal` with xterm.js.
- App theme following is the default terminal theme mode.
- Light app themes resolve to light terminal presets through `getTerminalTheme`.
- When a terminal background image is active, `XTermTerminal` uses `applyTransparency` to make the xterm theme background translucent.
- `applyTransparency` currently uses a black translucent cell background for all themes.
- The terminal background image overlay CSS currently uses a black overlay for all themes.
- xterm.js supports runtime theme updates and supports `minimumContrastRatio` for foreground/background contrast adjustment.
- GitNexus MCP tools are not exposed in this Codex session. Local `npx --no-install gitnexus status` reports the repository is not indexed, so graph impact analysis is unavailable unless the index is rebuilt successfully.

## Requirements

- Keep the fix scoped to the built-in terminal contrast problem.
- Preserve existing dark-theme background image behavior.
- For light terminal themes with background images, use a light-friendly transparency/compositing strategy instead of darkening the terminal with black alpha.
- Improve xterm contrast protection so dim or muted ANSI text remains legible on light terminal backgrounds.
- Avoid changing unrelated terminal behavior, project CRUD, history, stats, backend commands, or other active task files.
- Do not overwrite concurrent changes from other tasks; stop if target files become dirty from outside this session.

## Acceptance Criteria

- In light app theme + terminal theme follow-app + background image enabled, Codex startup/output text remains readable.
- In light app theme without background image, Codex output remains at least as readable as before and should improve for low-contrast ANSI text.
- In dark app theme + background image enabled, the previous dark overlay behavior remains visually consistent.
- The change is limited to terminal theme/background rendering files and task artifacts.
- Frontend type-check passes or any failure is documented if unrelated.

## Out of Scope

- Redesigning all terminal presets.
- Adding new user-facing settings or translations.
- Changing Codex/Claude process startup commands.
- Backend or database changes.

## Implementation Notes

- Prefer theme-aware helpers in `terminalThemes.ts` so `XTermTerminal` can apply the same logic at creation and runtime theme updates.
- For background image overlay CSS, expose the overlay RGB/color through a CSS custom property instead of hardcoding black in CSS.
- Use xterm.js `minimumContrastRatio` conservatively; tune by terminal theme brightness.

## Open Questions

- None blocking. The user approved the direction and specifically noted the background image feature as the likely trigger.
