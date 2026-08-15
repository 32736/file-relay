# DESIGN.md — Drop visual world (Handoff Terminal)

Brand system for the Drop interface: a calm operational file handoff desk with
editorial structure, hard ink borders, warm paper surfaces, and one signal
accent. This document is the authority for UI implementation.

## 1. Brand strategy

- **Category**: personal file-transfer tool (consumer utility).
- **Audience**: the owner on desktop/mobile; recipients of share links.
- **Emotional promise**: lightweight, trustworthy, frictionless — "drop it and go".
- **Cultural position**: a friendly utility with the confidence of a small
  dispatch terminal, not a developer console or marketing site.
- **Core metaphor**: **handoff terminal** — a file moves along a clear path
  from one device to another (signal-orange square + white arrow).
- **Avoid**: purple/pink AI gradients, decorative marketing sections, stock
  imagery, and motion that slows down file operations.

## 2. Symbol system (handoff arrow)

- **Primary mark**: a rounded signal-orange square with a white bold handoff
  arrow and a 2 px ink outline/shadow.
- **Variants**: mark alone (favicon/app icon), mark + wordmark ("Drop" in
  Space Grotesk).
- **Motion**: the upload completion shows a small success dot with one ripple
  (already implemented in the task card); page-level motion stays ≤200 ms.
- **Iconography**: stroke SVG icons (download/share/select/copy/revoke),
  24 px grid, `--text` color. No emoji as icons.

## 3. Color

Warm paper-and-ink palette, light-first. Dark mode is token-ready but not
implemented this pass.

### Tokens (light)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#eeece6` | page background |
| `--surface` | `#fffdf8` | cards, dialogs, inputs |
| `--surface-muted` | `#e6e4dc` | hover rows, progress tracks |
| `--bg-warm` | `#f7f3eb` | hover surfaces |
| `--text` | `#181a19` | primary text and hard borders |
| `--text-muted` | `#646862` | secondary text |
| `--text-faint` | `#92968f` | captions and footer |
| `--primary` | `#e85b3f` | signal accent, focus ring, mark fill |
| `--primary-dark` | `#b63d2c` | active/hover accent |
| `--border` | `#d3d3ca` | hairline borders |
| `--border-strong` | `#181a19` | structural borders |
| `--danger` | `#b42318` | destructive actions |
| `--danger-soft` | `#f8e2dc` | destructive surfaces |
| `--success` | `#27734b` | success text |
| `--success-soft` | `#dcecdf` | success surfaces |

- Primary interactive elements use `--primary`; links/focus use the same signal
  color. Hard borders use `--text` (2 px). Focus ring: 2 px `--primary`
  outline with 2 px offset.

### Elevation

- Cards/surfaces: 1 px `--border` hairline OR a soft shadow — never both on the
  same element.
- Default shadow: `0 1px 2px rgba(20,30,40,0.05), 0 6px 20px rgba(20,30,40,0.06)`.
- Floating (dialog, dropdown): `0 2px 4px rgba(20,30,40,0.06), 0 12px 32px rgba(20,30,40,0.12)`.

## 4. Typography

- **Wordmark**: Satoshi/Avenir Next/system fallback 800, `-0.02em`, 20–24 px; the "o" in
  "Drop" is the accent dot (brand detail). No serif anywhere.
- **Type scale** (Satoshi/Avenir Next, system fallback):

| Role | Size / weight | Use |
|---|---|---|
| Page title (public share) | 24 / 700 | file name on share page |
| Section title | 18 / 700 | "分享管理", dialog titles |
| Body | 15 / 400 | default |
| Small / caption | 13 / 400 | meta, hints, footer |
| Micro | 12 / 600 | badges, labels |

- Body measure 65–75ch; line-height 1.5 (titles 1.25); no letter-spacing below
  `-0.02em`.
- `lang="zh-CN"` stays; keep existing Chinese copy (do not reword copy without
  asking).

## 5. Components

- **Radius**: `--radius-sm` 10 px (inputs, chips), `--radius-md` 14 px
  (buttons, task cards), `--radius-lg` 20 px (dialogs, upload drop area).
  Pills (`999px`) only for status badges.
- **Primary button**: `--accent-strong` fill, white text, `--radius-md`,
  hover `filter: brightness(1.06)` + shadow, active translateY(0.5px);
  disabled 45% opacity. Focus ring visible.
- **Ghost button**: transparent, 1 px `--border-strong`, hover `--surface-muted`
  fill.
- **Drop area**: dashed 2 px `--border-strong`, `--radius-lg`, hover/focus
  border `--accent` + `--accent-soft` fill; on drop, one ripple on the dot mark.
- **Task card**: `--surface`, `--radius-md`, hairline border; progress bar =
  accent fill, `transform: scaleX` animation (not width).
- **Table rows**: hairline separators, hover `--surface-muted`; select-all
  checkbox keeps `indeterminate`.
- **Status badge**: pill, `--success-soft`/`--danger-soft` fills, matching text.
- **Dialog**: `--surface`, `--radius-lg`, floating shadow, `aria-modal`,
  focus-in + Esc-out (already implemented).

## 6. Layout

- Owner workspace: compact top bar (mark + wordmark + tabs + stats), content
  on a centered 72–88ch column. No marketing hero inside the workspace.
- Public share page: slim header (mark + wordmark), file-name title, download
  card — the task is the page.
- Signed-out page: one calm panel (mark, wordmark, one-line promise, sign-in
  button) centered.
- Spacing scale: 4/8/12/16/24/32/48; generous separation, tight groups.
- Mobile: single column, thumb-zone actions, ≥44×44 pt targets.

## 7. Motion

- One authored moment (upload ripple). Everything else ≤200 ms ease-out
  (hover, focus, dialog, row tint).
- `prefers-reduced-motion`: disable ripple and transitions.

## 8. Implementation map

Pass 1 (this redesign):

- `src/styles.css`: replace token block (colors, radii, shadow, type scale);
  drop the brand-green/Georgia hero styles; keep `:focus-visible` and button
  hover from the last pass.
- `src/App.vue`: replace hero with compact consumer top bar; slim public
  header; signed-out panel; tabs restyle.
- Components (`UploadZone`, `FileList`, `ShareDialog`, `ShareList`,
  `SharePage`): apply token classes (radius/shadow/hover), restyle drop area
  and task cards, dot-mark progress states.
- `public/logo.svg` + `public/manifest.webmanifest`: new drop-ripple mark and
  accent colors.
- Accessibility and copy stay as-is (fixed in the previous pass).

Pass 2 (optional, after approval): dark mode tokens, ripple motion details.

## 9. Acceptance

- `pnpm typecheck` / `lint` / `test` / `build` green; detector (`detect.mjs`)
  zero findings.
- Contrast: body/caption ≥4.5:1, button text ≥4.5:1, non-text ≥3:1 (verified
  against the token table above).
- Every page reachable in one tap from the top bar; public page completes
  download without leaving the origin.
