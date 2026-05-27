# State Management

> How state is managed in this project.

---

## Overview

This project uses **Zustand** for global stores and `tauri-plugin-store` for persistent settings (`settings.json`). Local component state via `useState` is preferred for ephemeral UI.

Real state files live under `src/stores/`:

- `settingsStore.ts` — user preferences (theme, font, terminal background, shortcuts), persisted
- `terminalStore.ts` — PTY sessions, active session, splits, in-memory session overrides
- `projectStore.ts`, `historyStore.ts`, `syncStore.ts`, `templateStore.ts`, `commandHistoryStore.ts`, `sessionStore.ts`, `updateStore.ts`

(Filling status: spec captures only patterns we have hit in practice. Other sections remain "To be filled by the team".)

---

## State Categories

(To be filled by the team)

---

## When to Use Global State

(To be filled by the team)

---

## Server State

(To be filled by the team)

---

## Patterns

### Pattern: `migrate*` pure function for every persisted compound field

**Problem**: `tauri-plugin-store` writes whatever JSON shape you give it. Old installs have stale shapes when you add/rename fields. If `load()` trusts the disk blindly, the app crashes on rename or silently uses partial data after type evolution.

**Solution**: For every persisted compound field (object / enum union / list), define a **pure** `migrate*(value: unknown) -> T` that:

1. Returns the typed default if value is null/undefined/wrong-shape
2. For each sub-field: type-checks, range-clamps, or enum-validates; falls back to default per field
3. Is **pure** (no I/O, no store access) so it can be unit-tested in isolation

Then call it from `load()`.

**Example** (from `settingsStore.ts`):

```ts
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function migrateTerminalBackground(value: unknown): TerminalBackgroundSettings {
  if (!value || typeof value !== "object") return { ...DEFAULTS.terminalBackground };
  const v = value as Record<string, unknown>;

  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULTS.terminalBackground.enabled,
    imagePath: typeof v.imagePath === "string" || v.imagePath === null
      ? (v.imagePath as string | null)
      : DEFAULTS.terminalBackground.imagePath,
    imageSizeBytes:
      typeof v.imageSizeBytes === "number" && Number.isFinite(v.imageSizeBytes) && v.imageSizeBytes >= 0
        ? v.imageSizeBytes
        : null,
    opacity: clampNumber(v.opacity, 0, 100, DEFAULTS.terminalBackground.opacity),
    fit: (["cover","contain","center","tile"] as const).includes(v.fit as TerminalBackgroundFit)
      ? (v.fit as TerminalBackgroundFit)
      : DEFAULTS.terminalBackground.fit,
    // ...same for position, blur, overlayDarken
  };
}
```

**Tests** (when vitest is wired):

- `migrateX(undefined) === DEFAULTS.x`
- `migrateX(null) === DEFAULTS.x`
- `migrateX({})` returns defaults
- Each numeric field: out-of-range value gets clamped
- Each enum field: unknown literal gets default
- Each compound: type-mismatched sub-field falls back per-field (others survive)

### Pattern: Legacy key remapping next to the migration

When a field name or enum value changes between releases, keep a `LEGACY_*_MAP` next to its migrator and translate before validating.

**Example** (from `settingsStore.ts`):

```ts
const LEGACY_TERMINAL_THEME_MAP: Partial<Record<string, string>> = {
  luxuryCommerceLight: "saasAnalyticsDashboardLight",
  cryptoWalletDark: "investmentPlatformDark",
};

function migrateTerminalThemeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return LEGACY_TERMINAL_THEME_MAP[value] ?? value;
}
```

After migration, the store writes the new key back to disk:

```ts
if (storedX !== migratedX) await s.set("x", migratedX);
```

This keeps `settings.json` self-healing: one launch is enough to leave the legacy shape behind.

### Pattern: Transient flags live in the store but stay out of `Settings`

Some state belongs to the store object but **must not be persisted** — e.g. `terminalBackgroundMissing` (computed at load by file-existence check). Keep these fields on the Zustand store but exclude them from the `Settings` interface and from the `DEFAULTS` loop that writes to `tauri-plugin-store`.

**Anti-pattern**: putting `terminalBackgroundMissing` into the `Settings` interface — `load()` will read a stale boolean from disk and skip the actual file check.

**Pattern**:

```ts
interface Settings {
  // …persisted fields only
  terminalBackground: TerminalBackgroundSettings;
}

interface SettingsStore extends Settings {
  // …transient runtime flags
  terminalBackgroundMissing: boolean;
  clearTerminalBackgroundMissing: () => void;
}
```

`load()` recomputes the flag every launch; it is never written to `settings.json`.

---

## Common Mistakes

(To be filled by the team)
