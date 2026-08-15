# Phase 09 - PWA

## Goal

After product review, make Drop installable and mobile-friendly: a web app
manifest, a service worker offline shell, mobile UX polish, and a
capability-gated Web Share Target declaration. No offline upload queue.

## Read Before Work

- `AGENTS.md`
- `docs/architecture.md`
- `docs/cloudflare.md`
- `docs/cloudflare_private_file_drop_codex_implementation_plan.md` (§60)

## Scope

- `public/manifest.webmanifest` (installability: name, icons, standalone
  display, theme color).
- `public/sw.js`: a hand-written service worker caching the app shell
  (navigation requests) with network-first fallback; API (`/api/*`) and
  `/s/`-like asset paths are never cached.
- Service-worker registration in `src/main.ts` (production only).
- `public/logo.svg` (plus manifest icons referencing it; PWA install
  requires at least one icon — SVG is accepted by Chromium).
- Mobile UX: responsive polish in `src/styles.css` (compact layout, safe
  touch targets) — no behavioral change.
- Web Share Target declaration in the manifest (Chromium only; the page does
  not auto-consume shared payloads this phase — the receiver lands on the
  owner page and uploads normally. Capability-gated by the browser).
- Docs sync (`docs/cloudflare.md` note, `README.md` feature line).

## Out of Scope

- Offline upload queue (explicitly deferred).
- Native push notifications, background sync.
- Tauri/E2EE (Phases 10/11).

## Design Decisions (confirmed)

1. **Offline shell, not offline data.** The SW precaches the minimal
   navigation shell (`index.html`, Logo, and manifest) and serves it offline;
   hashed static assets are cached on first fetch. API requests are passed
   through untouched (never cached).
2. **Production-only registration.** The SW is registered only when
   `import.meta.env.PROD` — dev workerd/HMR must not fight a cache-first
   worker.
3. **Manifest + icons in `public/`.** `manifest.webmanifest` (name "Drop",
   `display: standalone`, theme color matching the UI) references
   `logo.svg` and a `maskable` icon. `index.html` links the manifest and sets
   `theme-color`.
4. **Share Target is declared, not consumed.** The manifest declares
   `share_target` for files; on Chromium the browser may offer "Drop" as a
   share destination. The receiving page is the normal SPA (no dedicated
   handler this phase); this is documented as a follow-up (consume
   `POST`/form payload when the flow is productized).
5. **No build plugin.** A hand-written SW and static manifest keep the Vite
   setup unchanged; asset URLs in the shell are cache-busted by Vite hashes,
   so the network-first strategy stays correct without precaching hashes.

## Implementation

- `public/manifest.webmanifest`
- `public/logo.svg`
- `public/sw.js` (network-first shell caching, API passthrough)
- `index.html`: `<link rel="manifest">`, `theme-color`, `apple-touch-icon`
- `src/main.ts`: `if (import.meta.env.PROD && 'serviceWorker' in navigator)`
  register `/sw.js`
- `src/styles.css`: responsive tweaks (compact hero, table → card on narrow
  screens)

## Tests

1. Manifest file exists and parses as JSON with `name`, `start_url`,
   `display: standalone`, icons, `theme_color`, and a `share_target` block.
2. `index.html` contains the manifest link and `theme-color`.
3. Registration logic: `src/main.ts` registers the SW only in production
   (unit-tested by extracting the registration into a tiny exported helper
   and stubbing `navigator.serviceWorker`/`import.meta.env`).
4. `sw.js` exists and contains the API-passthrough guard and shell caching
   markers (static string assertions).
5. Mobile CSS: no behavioral assertions; visual change only.

## Acceptance Criteria

- `pnpm build` emits the manifest, icons, and `sw.js` into the client output.
- The app is installable (manifest + SW + icons present); offline reload of
  the shell works after one online visit.
- API calls never get served from the SW cache.
- All required commands pass.

## Required Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Completion

1. Summarize changed files (expected: `public/manifest.webmanifest`,
   `public/logo.svg`, `public/sw.js`, `index.html`, `src/main.ts`,
   `src/styles.css`, `tests/pwa.test.ts`, docs).
2. State key design decisions and any deviation from the implementation plan.
3. Report validation command results.
4. Report unresolved issues (e.g., share-target payload consumption deferred).
5. Stop. Do not start Phase 10.

---

# 设计决策摘要（中文，供人工 review）

- **离线壳而非离线数据**：SW 只缓存导航壳（构建后的 index.html）+ 运行时缓存其静态资源；网络优先、失败回退缓存；`/api/*` 永不缓存。
- **仅生产注册**：`import.meta.env.PROD` 才注册 SW，避免 dev/HMR 冲突。
- **manifest + SVG 图标**放 `public/`；`index.html` 链 manifest + theme-color。
- **Share Target 只声明不消费**：manifest 声明文件 share_target（Chromium 可把 Drop 当分享目标），接收页即普通 SPA；真正消费共享载荷留作后续（文档注明）。
- **不引入构建插件**：手写 SW + 静态 manifest，Vite 配置不变。
