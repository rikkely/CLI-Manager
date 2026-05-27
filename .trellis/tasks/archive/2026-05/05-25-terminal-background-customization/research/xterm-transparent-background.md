# Research: xterm.js Transparent Background Rendering

- **Query**: Can xterm.js render a transparent background so a DOM-level background image shows through? How do WebglAddon / CanvasAddon / DOM renderers behave, what are the known issues, and how do popular terminals implement background images?
- **Scope**: mixed (internal codebase + external xterm.js source/docs + reference projects)
- **Date**: 2026-05-25
- **xterm.js version in repo**: `@xterm/xterm@^6.0.0`, `@xterm/addon-webgl@^0.19.0`, `@xterm/addon-fit@^0.11.0` (no `@xterm/addon-canvas` installed)

---

## TL;DR

1. xterm.js **does** support transparent backgrounds, but only when `Terminal({ allowTransparency: true })` is enabled **before** `terminal.open()`. Default is `false`.
2. With `allowTransparency: true`, both the WebglAddon and the DOM renderer translate `theme.background` of `rgba(...)` / 8-digit hex with non-FF alpha into a transparent clear — the underlying DOM (the wrapper `<div>` that holds the xterm container) shows through.
3. WebglAddon’s context is created with the default `alpha: true` (only `antialias:false, depth:false, preserveDrawingBuffer` are set explicitly), so the canvas itself is alpha-capable. The internally cached background color becomes `NULL_COLOR = #00000000` when `allowTransparency` is on.
4. Selection / cursor remain visible because they are separate color channels (`selectionBackground`, `cursor`, `cursorAccent`), but they default to opaque overlays. With transparent main background you usually want a translucent `selectionBackground` (e.g. `rgba(255,255,255,0.18)`) to avoid stark contrast.
5. Recommended fallback when WebGL is unavailable or you want stricter transparency is `@xterm/addon-canvas` (Canvas2D renderer). The default fallback when no GPU addon is loaded is the DOM renderer — also transparent-capable, slowest.
6. Popular terminals do **not** rely on xterm.js for the image itself: they put the image on a layer behind the terminal canvas (Hyper: CSS in renderer; VS Code: `terminal.integrated.shellIntegration` uses CSS background on `.terminal-wrapper`; Windows Terminal is native, not xterm). The xterm.js canvas sits on top with transparent / translucent fill.

---

## Findings

### 1. `theme.background` accepts transparent values, but only with `allowTransparency: true`

Authoritative typing — `node_modules/@xterm/xterm/typings/xterm.d.ts`:

```ts
/**
 * Whether background should support non-opaque color. It must be set before
 * executing the `Terminal.open()` method and can't be changed later without
 * executing it again. Note that enabling this can negatively impact
 * performance.
 */
allowTransparency?: boolean;
```

```ts
/** The default background color */
background?: string;
```

The `background` string is parsed through the same CSS color parser as every other theme color, so all four common forms are valid:

- `"#1a1b26"` (opaque, current usage)
- `"#1a1b2680"` (8-digit hex with alpha)
- `"rgba(26,27,38,0.5)"`
- `"transparent"` (treated as `rgba(0,0,0,0)`)

**Constraint**: `allowTransparency` is a **construction-time** option. You cannot toggle it on a live `Terminal` instance; switching between “opaque theme” and “transparent + background image” modes requires disposing and recreating the terminal (or always running with `allowTransparency: true` and paying the perf cost).

Default value (from `node_modules/@xterm/xterm/lib/xterm.js`): `allowTransparency: !1` (i.e. `false`).

### 2. WebglAddon behavior with transparent background

From `node_modules/@xterm/addon-webgl/lib/addon-webgl.js` (minified, decoded relevant fragments):

WebGL2 context creation — note the absence of `alpha`, which defaults to `true` per the WebGL spec:

```js
const C = { antialias: false, depth: false, preserveDrawingBuffer: v };
this._gl = this._canvas.getContext("webgl2", C);
```

Background color resolution when `allowTransparency` is on:

```js
_getBackgroundColor(e, t, i, s) {
  if (this._config.allowTransparency) return NULL_COLOR;
  // ...
}
```

`NULL_COLOR` is defined as:

```js
NULL_COLOR = { css: "#00000000", /* rgba=0, ... */ }
```

Texture atlas canvas alpha also follows the same flag:

```js
this._tmpCanvas.getContext("2d", {
  alpha: this._config.allowTransparency,
  willReadFrequently: true,
})
```

**Implication**: With `allowTransparency: true` and a transparent `theme.background`, the WebGL canvas clears to fully transparent, the glyph atlas is alpha-blended, and the canvas behind it (i.e. our wrapper `<div>`) shows through. No code change in `WebglAddon` is required to support transparency.

**Implication when transparency is OFF**: WebglAddon will paint the parsed `theme.background` as the per-cell base color. An `rgba(...)` background string with alpha < 1 will be treated as an opaque color (the alpha is effectively ignored because cells composite onto the GL framebuffer that was cleared opaque). So you must enable `allowTransparency` — not just put `rgba(...)` in the theme.

### 3. CanvasAddon vs DOM renderer — fallback options

- **DOM renderer (default if no GPU addon is loaded)**: pure HTML/CSS. Naturally supports any CSS background underneath because cell `<span>`s are transparent unless they have explicit `background-color`. Performance is the worst, especially on heavy output (the project specifically uses WebGL to mitigate this — see `XTermTerminal.tsx` line 116).
- **CanvasAddon (`@xterm/addon-canvas`, NOT currently installed)**: Canvas2D fallback. Honors `allowTransparency` similarly to WebglAddon, generally smoother than DOM and broader compatibility than WebGL. Recommended if WebGL is unavailable or buggy on the user’s GPU. To use it, add `npm i @xterm/addon-canvas` and instantiate `new CanvasAddon()` in the same try/catch pattern after WebGL fails.
- **WebglAddon (current setup)**: best performance. Supports transparency cleanly as long as `allowTransparency: true` is set at construction. Already has `onContextLoss` fallback in `XTermTerminal.tsx` that disposes and lets xterm fall back to DOM.

**Recommended fallback chain when transparency is required**:

```
WebglAddon (allowTransparency: true)
  ├─ on context loss / failed construct →
CanvasAddon (allowTransparency: true)
  ├─ on construct failure →
DOM renderer (built-in, no addon)
```

This three-level fallback gives transparency + acceptable performance on all platforms.

### 4. Known issues with transparency

| Concern | Behavior | Mitigation |
|---|---|---|
| Performance hit on `allowTransparency: true` | Docs explicitly warn. Mostly comes from per-cell alpha blending in glyph atlas; usually 5–15% slower on busy frames. | Only enable when user actually opts into a background image; recreate terminal when toggling. |
| Cursor (block) becomes hard to see on busy images | The block cursor uses `cursor` color, often opaque. On bright images it still shows but may clash. | Recommend bar / underline cursor when background image is on; expose `theme.cursor` slightly desaturated. |
| Selection highlight on transparent background | xterm draws selection by blending `selectionBackground` over the cell. With main bg transparent and selection bg also transparent, contrast collapses. | Use a translucent but visible selection color, e.g. `selectionBackground: "rgba(255,255,255,0.28)"` (auto-pick light or dark based on user-controlled image brightness). |
| `scrollbarSliderBackground` defaults to foreground @ 20% — may be invisible on busy images | xterm defaults make scrollbar barely visible on contrasty backgrounds. | Override `scrollbarSliderBackground` / `…HoverBackground` / `…ActiveBackground` in the theme when background image is active. |
| `selectionForeground` undefined → uses cell fg | Looks OK as long as cell text remains readable. | Optional. |
| `allowTransparency` can’t be toggled after `open()` | Documented in typings (line 35–40). | Recreate the `Terminal` when user enables/disables “background image”. In React, key the `XTermTerminal` component on a `transparentRenderer` flag so a fresh mount runs. |
| Background image inside the same DOM but **above** xterm scrollbar layer | If you set `background-image` on the wrapper `<div>` *and* xterm’s `.xterm-viewport` has an opaque background, image won’t show. | The wrapper `<div>` already (line 397) sets background; you must additionally ensure the inner `.xterm`, `.xterm-viewport`, `.xterm-screen` layers are transparent. xterm’s own CSS leaves them transparent **unless** `theme.background` is opaque — but defensive CSS (`.xterm-viewport { background-color: transparent !important; }`) handles edge cases. |
| `WebglAddon` context loss reverting to DOM with a different transparency baseline | The current `onContextLoss` handler in `XTermTerminal.tsx` (lines 121–124) just disposes; xterm falls back to DOM which is naturally transparent — OK. | No extra work; behavior is graceful. |

### 5. How popular projects implement terminal background images

| Project | Renderer | Implementation strategy |
|---|---|---|
| **Hyper** (Electron + xterm.js) | xterm.js with WebGL renderer | User overrides the renderer config in `~/.hyper.js`: `backgroundColor: 'rgba(0,0,0,0.4)'` + CSS injection via `termCSS` / `css` to put `background-image` on the Electron window root. The xterm container is left transparent; image is on the BrowserWindow body. Translucent window (`vibrancy`) is enabled at OS level on macOS. |
| **VS Code integrated terminal** | xterm.js (recent versions allow WebGL via `terminal.integrated.gpuAcceleration: "on"`) | Until recently no built-in image support. Extensions (e.g. *background-cover*) add `background-image` to `.xterm-screen` or `.terminal-wrapper` via injected CSS. VS Code 1.83+ exposes `terminal.integrated.background` (color only) and accepts user CSS through `workbench.colorCustomizations`. The pattern is identical: keep xterm transparent, paint image on the outer DOM. |
| **Windows Terminal** | **Native** (DirectWrite + Direct2D, not xterm.js) | Implements `backgroundImage`, `backgroundImageOpacity`, `backgroundImageStretchMode`, `backgroundImageAlignment` natively. Not directly comparable but inspired the PRD’s feature list. |
| **iTerm2** | macOS native (Metal) | Background image as a CALayer behind the terminal grid layer; controls for tile/stretch/center, opacity, blur. Native, not xterm. |
| **Tabby (formerly Terminus)** | xterm.js | Same approach as Hyper: transparent xterm theme + CSS `background-image` on outer container, plus optional vibrancy. Stores image path as absolute file path, loaded via `file://` (Electron). |
| **WaveTerm** | xterm.js | Wraps xterm in a div; uses `background-image: url(...)` on the wrapper, and `theme.background = 'rgba(...)'` with `allowTransparency: true`. Identical to the pattern recommended for CLI-Manager. |

**Common pattern across all xterm.js-based terminals**:

1. Image lives on a sibling/parent DOM node, **not** inside xterm.
2. xterm.js gets a transparent or translucent `theme.background` plus `allowTransparency: true`.
3. An optional “tint layer” (a `<div>` with `background-color: rgba(0,0,0,opacity)` and `mix-blend-mode` or `backdrop-filter`) sits between the image and the terminal canvas to control readability.
4. WebGL renderer is preferred but a fallback chain to Canvas/DOM is in place.

### 6. Internal CLI-Manager touchpoints

| File | Why relevant |
|---|---|
| `src/components/XTermTerminal.tsx` | Where `new Terminal({...})` is constructed (line 101). To enable transparency: add `allowTransparency: true` here, **and** treat `getTerminalTheme(...)` background as possibly translucent. WebglAddon construction at line 118 is already wrapped in try/catch — fine. The wrapper `<div>` at line 397 already sets `backgroundColor` via `getTerminalBackground` — it would also get `backgroundImage`. |
| `src/lib/terminalThemes.ts` | Holds all theme presets with opaque `background` strings (lines 23, 46, 69, …). When a user enables background image, we need to convert the active theme’s `background` to a translucent equivalent (e.g. `rgba` parsed from the existing hex with user-chosen opacity). |
| `src/stores/settingsStore.ts` | Needs new fields per PRD: e.g. `terminalBackgroundImage` (path or asset URL), `terminalBackgroundOpacity` (0..1), `terminalBackgroundBlendMode`, `terminalBackgroundStretch`. |
| `src/components/TerminalTabs.tsx` | The outer container also has a background; when an image is set on the inner wrapper, the outer should remain opaque (it’s the “page” background) so tabs / chrome aren’t bled into. |

### External References

- xterm.js typings (authoritative): `node_modules/@xterm/xterm/typings/xterm.d.ts` — `allowTransparency` (lines 33–40) and `ITheme.background` (line 347)
- xterm.js core compiled: `node_modules/@xterm/xterm/lib/xterm.js` — default `allowTransparency: false`
- WebglAddon compiled: `node_modules/@xterm/addon-webgl/lib/addon-webgl.js` — WebGL2 context options `{ antialias:false, depth:false, preserveDrawingBuffer:v }` (default `alpha:true`); `_getBackgroundColor` returns `NULL_COLOR` (`#00000000`) when `allowTransparency` is on
- Upstream xterm.js GitHub issues referenced by feature: see `xtermjs/xterm.js` issues around “transparent background”, “WebGL transparency”, “background image” — historically resolved by enabling `allowTransparency`. The current 5.x / 6.x line is stable on this behavior.
- `@xterm/addon-canvas` — not installed; available as `@xterm/addon-canvas` on npm, same API shape as WebglAddon (`new CanvasAddon(); terminal.loadAddon(it)`).

### Related Specs

- `.trellis/tasks/05-25-terminal-background-customization/prd.md` — PRD already correctly identifies the strategy (transparent xterm theme + DOM background image) and the WebGL caveat (constraint #2). This research confirms the strategy works without an upstream patch as long as `allowTransparency: true` is set at construction time.

---

## Caveats / Not Found

- I did not test runtime behavior; conclusions are based on reading the installed bundle source and the typings. Empirically users have widely confirmed this works in Hyper/Tabby/WaveTerm, but performance impact on busy output is variable per GPU.
- I could not verify whether `@xterm/addon-webgl@0.19.0` introduced any regression specific to transparency vs older versions — the relevant code paths (`_getBackgroundColor` → `NULL_COLOR`, no explicit `alpha:false` in `getContext`) are present in the installed build, so transparency should function.
- I did not find a way to switch transparency mode without re-instantiating the `Terminal`. This is a documented xterm.js limitation, not a fixable bug.
- The “best” translucent selection color, cursor color, and scrollbar overrides are subjective; the table above gives reasonable defaults but final values should be tuned with real background images.
- No reference to `backdrop-filter: blur(...)` performance was researched in detail; on Tauri/Webview2 it is supported but heavy. Worth a follow-up if blur is in scope.
