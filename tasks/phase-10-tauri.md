# Phase 10 - Tauri Desktop Client (Independent Design)

## Status

**Design only.** Per `tasks/phase-10-tauri.md`, an independent desktop
security and distribution design must be created and approved before any
Windows/macOS integration, tray behavior, file-manager actions, or clipboard
uploads are implemented. This document is that design; it is **not** an
implementation task.

## Product position

Drop's Web app is the primary client. The desktop client is a convenience
wrapper: drag-drop from Explorer/Finder, tray upload, clipboard image upload,
and "Send to Drop" integration. It talks to the same Drop origin over HTTPS;
there is no separate server.

## Architecture (Tauri 2)

```text
Tauri core (Rust)
 ├── WebView (front-end, the existing Vue SPA recompiled for desktop)
 ├── Local capability plugins (tray, clipboard, file dialogs, shell integration)
 └── Secure credential store (OS keychain via `keyring`)
```

- The SPA code is reused (upload/list/share pages) with a desktop entry point.
- Heavy/native operations live in Rust plugins exposed to the WebView through
  a minimal, capability-gated IPC surface.
- No remote code execution: the WebView loads only bundled assets; all
  network access goes to the configured Drop origin over HTTPS with
  certificate validation (no custom CA, no `dangerousRemoteDomainIpcAccess`).

## Security design

1. **Credentials.** The owner session token is stored in the OS keychain
   (Windows Credential Manager / macOS Keychain), never in plaintext config
   files. The token is the same `__Host-drop_session` value or a scoped
   long-lived client token issued by the server (decide in implementation:
   prefer a dedicated client token with revoke, not the browser session).
2. **IPC hardening.** Tauri commands are allow-listed (no wildcard
   `invoke`); the WebView cannot reach arbitrary Rust functions. File paths
   from the shell are validated before upload (no traversal, no symlink
   surprises — reuse the server-side basename rules client-side too).
3. **Update & supply chain.** Signed bundles (Windows Authenticode, macOS
   notarization); Tauri updater signatures verified against a pinned public
   key. Distribution through GitHub Releases (or later an app store), never
   via ad-hoc links.
4. **Clipboard/tray privacy.** Clipboard reads happen only on explicit user
   action; tray menu actions are local; no telemetry.

## Features (for the implementation phase)

- Tray icon: "Send to Drop" (file picker), clipboard image upload, open main
  window, quit.
- Explorer/Finder: "Send to Drop" shell extension / macOS Quick Actions
  (capability-gated per platform).
- Drag & drop into the main window reuses the existing upload pipeline.
- Deep link to shares (`drop://s/<token>` handling optional).

## Distribution matrix

| Platform | Bundle | Signing | Store |
| --- | --- | --- | --- |
| Windows | MSI/NSIS | Authenticode | optional |
| macOS | DMG | Notarized | optional |
| Linux | AppImage/deb | — | optional |

## Explicitly out of scope for the design approval

- P2P transfer, LAN sync, multi-account, offline upload queue.

## Approval gate

Implementing any of the above requires: (1) this design approved, (2) a
scoped `tasks/phase-10-tauri.md` implementation task (credential storage +
token model first), and (3) the server-side client-token endpoint designed in
the same phase. Do not start without all three.
