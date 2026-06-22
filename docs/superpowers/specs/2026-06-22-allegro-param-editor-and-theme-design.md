# Design: type-aware Allegro parameter editor + three-state theme

Date: 2026-06-22
Status: approved (design), pending implementation plan

## Context

`allegro-clone-offer` clones an Allegro offer with parameter overrides (e.g. SSD
256GB → 512GB). Two issues drive this work:

1. **Theme.** A light/dark toggle exists (`ThemeToggle`), but once clicked the
   choice is stored and the app stops following the OS theme forever. There is no
   explicit "follow system" mode and no live reaction to OS theme changes.

2. **Parameter editor.** `OverridesEditor` renders a single free-text `Combobox`
   for *every* parameter regardless of its Allegro type, and the wire contract
   (`paramOverrides: Record<string, string>`) allows only **one value per
   parameter**. Allegro parameters are typed (dictionary / integer / float /
   string), some dictionaries allow **multiple values** (e.g. ports: HDMI **and**
   USB via `restrictions.multipleChoices`), and numeric params can be ranges.
   None of that is representable today.

The server already fetches and passes through the full category-parameter object
(`type`, `required`, `unit`, `restrictions`, `options`, `dictionary`) via
`GET /api/offers/:id/preview` → `categoryParameters`; the frontend type just
doesn't surface `required`/`unit`/`restrictions`.

## Allegro parameter schema (verified)

Verified against the official `developer.allegro.pl/swagger.yaml`
(`CategoryParameter` family, schema lines ~26280–26650) on 2026-06-22.

The parameter is **polymorphic on `type`** (OpenAPI `discriminator`), with exactly
four mapped types. Two parallel families exist — `CategoryParameter` (offer side,
returned by our endpoint `GET /sale/categories/{categoryId}/parameters`) and
`CategoryProductParameter` (catalog product card); their fields are identical for
our purposes.

Base fields: `id`, `name`, `type`, `required` (boolean), `requiredIf`
(`CategoryParameterRequirementConditions`), `displayedIf`
(`CategoryParameterDisplayConditions`), `unit` (string|null), `options`,
`formerData`.

Per-type `restrictions` (exact field names):

- `dictionary` → `restrictions.multipleChoices` (boolean — "Indicates whether
  this parameter can have more than one value"). **This is the HDMI + USB case.**
- `integer` → `restrictions.min`, `restrictions.max`, `restrictions.range`
  (boolean — if `true`, provide `from` and `to`, both within min/max).
- `float` → `restrictions.min`, `restrictions.max`, `restrictions.range`,
  `restrictions.precision` (digits after the decimal point).
- `string` → `restrictions.minLength`, `restrictions.maxLength`,
  `restrictions.allowedNumberOfValues` (how many distinct values are allowed —
  **strings can also be multi-value**).

`options` (`CategoryParameterOptions`): `ambiguousValueId` (string|null —
dictionary id flagged as ambiguous/"other"), `dependsOnParameterId` (string|null),
`describesProduct` (boolean), `customValuesEnabled` (boolean — "a custom value can
be added to a parameter **with an ambiguous value**"; i.e. only meaningful for a
dictionary that has an `ambiguousValueId`).

`dictionary[]` entries: `id` (use this to set the value in an offer/product),
`value` (Polish label), `dependsOnValueIds` (array — ids from the parameter named
by `options.dependsOnParameterId` this value may combine with), `formerData`.

Implications for the design:
- Dictionary values are addressed by `id` (`valuesIds`); `value` is a display
  label. Clone currently sends the label and lets Allegro resolve — we may send
  `valuesIds` for robustness (refinement, not required).
- Free-text entry is gated by `customValuesEnabled` AND the presence of an
  `ambiguousValueId`, not by `customValuesEnabled` alone.
- `string` multi-value (`allowedNumberOfValues > 1`) is real but rare for laptop
  categories — supported by the same array contract; UI may allow adding values.

## 1. Three-state theme

Replace the boolean toggle with a tri-state **preference**:
`ThemePref = 'system' | 'light' | 'dark'`, default `'system'`.

- Storage key stays `allegro.theme`; now stores the preference verbatim.
- Resolved theme: `pref === 'system' ? prefers-color-scheme : pref`.
- In `system` mode, subscribe to `matchMedia('(prefers-color-scheme: dark)')`
  `change` and re-apply live; unsubscribe when pref leaves `system`.
- UI: a 3-button segmented control (Система / Светлая / Тёмная).
- Update all three theme sites:
  - `web/src/theme.ts` — type + getters + `applyTheme(resolved)` + storage.
  - `web/src/components/ThemeToggle.tsx` — segmented control + matchMedia listener.
  - `web/index.html` — inline no-flash script resolves preference the same way.

Backward compatibility: a previously stored `'light'`/`'dark'` value remains
valid; absence (or `'system'`) → follow system.

## 2. Full type-aware parameter editor

New `web/src/components/ParametersEditor.tsx` replaces `OverridesEditor.tsx`.
Renders **every** parameter from `preview.categoryParameters`, each with a
type-appropriate control, seeded with the current value from
`preview.parameters` (matched by id, then case-insensitive name).

Control mapping:

| Condition | Control |
|---|---|
| `dictionary` + `restrictions.multipleChoices` | checkboxes (multi-select) |
| `dictionary`, single, ≤ 6 entries | radio group |
| `dictionary`, single, > 6 entries | searchable select / combobox |
| `integer` | number input, `step=1`, min/max, unit suffix |
| `float` | number input, `step` from `precision`, min/max, unit suffix |
| numeric + `restrictions.range` | two number inputs (from – to), display only in v1 (see contract note) |
| `string` | text input, `maxLength`; if `allowedNumberOfValues > 1`, allow adding multiple values |
| dictionary + `options.customValuesEnabled` && `ambiguousValueId` | also allow a free-text value outside the dictionary |

- `required` params marked with `*`.
- Each row shows a "сейчас: …" current-value hint and a "изменено" badge when
  the working value differs from the current value.
- Toolbar: name filter, "только изменённые" toggle, and the existing quick
  presets (SSD→512GB/1TB/2TB, RAM→16/32GB) as shortcuts.

**Emit only changes.** The editor holds a working copy of all parameter values
(seeded from current). `cleanedOverrides` is the **diff** vs current values →
only changed parameters are sent. This preserves existing clone semantics: no
overrides → reuse source product card; overrides present → catalog search. The
"показать все" UI must not turn every parameter into an override.

Out of scope (YAGNI): `dependsOnParameterId` cascade filtering (show full
dictionary), variant parameters (`options.variantsAllowed`), and emitting range
(`restrictions.range`) overrides (rendered but display-only in v1).

## 3. Multi-value contract

`paramOverrides`: `Record<string, string>` → **`Record<string, string[]>`**
(value = an ordered **list of selected values**: a one-element array for
single-value params; multiple entries for `multipleChoices` dictionaries and
multi-value strings). Key remains the parameter **name** (consistent with current
case-insensitive matching), since the whole clone pipeline keys by name.

The server applies overrides without knowing each parameter's type, so the array
is unambiguously a *value list*. **Range params are NOT encoded in this contract
in v1** — a 2-element array would be indistinguishable from a 2-value multi-select.
The editor renders a range's from/to inputs (seeded from the current value) but
does not emit a range override in v1 (deferred); range editing would need the
parameter `type` carried alongside the override.

- `server/src/routes/api.ts` zod `cloneSchema.paramOverrides`:
  `z.record(z.string(), z.array(z.string()))`.
- `server/src/core/clone.ts` `CloneOptions.paramOverrides` type; in
  `buildCloneBody` apply override as `values: newValues` (was `[newValue]`);
  `buildSearchPhrase` / title substitution use `newValues[0]`;
  `scoreParameterMatch` already compares arrays.
- `web/src/api.ts`: `ClonePayload.paramOverrides: Record<string, string[]>`;
  extend `OfferPreview.categoryParameters[]` with `required?`, `unit?`,
  `restrictions?`.
- `web/src/App.tsx`: replace `overrides: ParamOverride[]` state with the editor's
  working model; `cleanedOverrides` becomes the diff producing
  `Record<string, string[]>`.
- `buildVarMap` (description variables) consumes the first value (or joins) per
  parameter.

## 4. Files touched

**web:** `components/ParametersEditor.tsx` (new, replaces
`OverridesEditor.tsx`), `App.tsx`, `api.ts`, `theme.ts`,
`components/ThemeToggle.tsx`, `index.html`.

**server:** `routes/api.ts`, `core/clone.ts`, `core/clone.test.ts`.

## 5. Testing

- `clone.test.ts`: update override application to the array contract; add a case
  for a multi-value override (`values` has > 1 entry) reaching the body.
- Manual: load an offer in a category with a `multipleChoices` dictionary
  (ports / złącza), confirm checkboxes render and multiple selections survive
  into the clone preview body; confirm radio/select/number/range render per type;
  confirm theme segmented control + live OS switch in `system` mode.

## Risks

- Replacing the editor changes `App.tsx` wiring and the wire contract in one
  change — keep the diff-only emission to avoid altering catalog-binding
  behavior.
- Large categories (24+ params) → the panel must scroll and stay readable; the
  name filter + "только изменённые" mitigate this.
