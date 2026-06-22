# Task 1 Report: Three-state theme (Система/Светлая/Тёмная)

## What Was Implemented

All 8 TDD steps from the brief were completed in order:

1. **theme.ts** — full rewrite: exported `ThemePref`, `ResolvedTheme`, `getStoredPref`, `getSystemTheme`, `resolveTheme`, `applyTheme`, `setStoredPref`. Removed `Theme`, `getInitialTheme`, `getStoredTheme`, `setStoredTheme`.
2. **theme.test.ts** — created verbatim from brief: 5 assertions covering `resolveTheme` (explicit pref, system resolution via matchMedia stub) and `getStoredPref` (default, read, invalid fallback).
3. **ThemeToggle.tsx** — full rewrite: segmented control with three buttons (Авто/Светлая/Тёмная), live OS tracking via matchMedia `change` event in system mode.
4. **index.html** — no-flash script updated to handle `system`/`light`/`dark` prefs correctly.

## TDD Evidence

### RED (Step 2)
Command: `npm run test -w web -- theme --run`
Output:
```
Tests  5 failed (5)
 ❯ src/theme.test.ts (5 tests | 5 failed)
   × resolveTheme > returns the explicit preference unchanged → resolveTheme is not a function
   × resolveTheme > resolves "system" via prefers-color-scheme → resolveTheme is not a function
   × getStoredPref > defaults to "system" when nothing is stored → getStoredPref is not a function
   ...
```
Expected reason: old `theme.ts` exported `getInitialTheme`/`getStoredTheme` — neither `resolveTheme` nor `getStoredPref` existed.

### GREEN (Step 4)
Command: `npm run test -w web -- theme --run`
Output:
```
 ✓ src/theme.test.ts (5 tests) 1ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

## Files Changed

- `web/src/theme.ts` — full rewrite (new API)
- `web/src/theme.test.ts` — created
- `web/src/components/ThemeToggle.tsx` — full rewrite (segmented control)
- `web/index.html` — no-flash script updated
- `web/vitest.config.ts` — added `setupFiles` (see Infrastructure below)
- `web/src/test-setup.ts` — created (see Infrastructure below)

## Infrastructure Fix Required (Beyond Brief)

**Problem:** Node v25.2.1 (the runtime on this machine) exposes a built-in global `localStorage` that is non-functional without `--localstorage-file`. Vitest's `populateGlobal` only overrides globals that are in its explicit KEYS whitelist — `localStorage` is not on that list. Therefore jsdom's proper `Storage` implementation never replaced Node's broken stub, causing `localStorage.setItem is not a function` in the three `getStoredPref` tests.

**Fix:** Added `web/src/test-setup.ts` which runs `beforeAll` and manually promotes `jsdom.window.localStorage` onto `globalThis`. Updated `vitest.config.ts` to reference this file via `setupFiles`. This is purely a test infrastructure fix; production code is unchanged.

## Self-Review Findings

- No stale references to `getInitialTheme`, `getStoredTheme`, `setStoredTheme`, or bare `type Theme` remain in `web/src/`.
- Confirmed with `grep -rn "getInitialTheme\|getStoredTheme\|setStoredTheme" web/src/` — clean.
- Build is clean: `tsc -b && vite build` completed with 0 errors, 51 modules.
- The brief's commit message is used verbatim (plus Co-Authored-By trailer).
- The two extra files (`vitest.config.ts`, `test-setup.ts`) are appropriate additions — without them the test suite can't run on this Node version.

## Concerns

One mild concern: the brief says "localStorage/matchMedia mocking works as in the brief's test" implying zero config changes needed. That wasn't true on Node v25.2.1. The `test-setup.ts` fix is small and correct, but it's an undocumented addition. If this codebase ever migrates to an older Node version or a different test runner, the setup file is harmless (jsdom.window.localStorage will already be the global).

## Fix wave 1

### Changes made

**Fix 1 (Important) — `web/src/test-setup.ts` rewritten:**
Replaced the `globalThis.jsdom?.window?.localStorage` approach (undocumented jsdom internal) with a self-contained implementation. The new file defines a `MemoryStorage` class (implements `Storage`) and an `isFunctionalStorage` probe. In `beforeAll`, it checks whether the active `globalThis.localStorage` is functional (probe `setItem`/`removeItem`); if not, it installs `MemoryStorage` via `Object.defineProperty`. This is robust against any jsdom version change.

**Fix 2 (Minor) — `web/src/theme.test.ts`:**
Added `afterEach(() => vi.unstubAllGlobals())` inside the `resolveTheme` describe block so the `matchMedia` stub installed by the "resolves system" test is torn down after each test and does not leak into other suites.

No changes to `web/vitest.config.ts` (still points at `web/src/test-setup.ts`).

### Test run

Command: `npm run test -w web`

```
 RUN  v2.1.9 /…/COPY Product ALLGRO/web

 ✓ src/theme.test.ts               (5 tests)  1ms
 ✓ src/components/descriptionLayout.test.ts  (7 tests)  1ms
 ✓ src/components/shortcodes.test.ts        (50 tests) 11ms
 ✓ src/components/descriptionSanitize.test.ts (22 tests) 13ms

 Test Files  4 passed (4)
      Tests  84 passed (84)
   Duration  570ms
```

All 84 tests pass, output pristine (only expected Node `--localstorage-file` warnings unrelated to the fix).
