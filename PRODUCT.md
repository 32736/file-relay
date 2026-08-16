# Product: Drop

## One-liner

A private, owner-operated file handoff point: upload from one device, download
or share from another, all through a single origin (`drop.28207.cc`).

## Audience

The owner (single user) across desktop and mobile, plus anyone receiving a
share or incoming link. Usage scene: quick transfers between the owner's own
devices and short-lived shares to others.

## Core jobs

- Upload files (single ≤ 32 MiB, multipart above, resumable).
- List, search, delete, and download files (streaming, Range).
- Create expiring / download-limited / burn-after-reading shares with QR codes.
- Receive files from others (removed in 2026-08 trim; no longer part of the
  product).

## Emotional promise

Lightweight and trustworthy: "drop it and go". No accounts for recipients, no
clutter, files are reachable again on another device.

## Brand metaphor

**Drop ripple** — a point is *dropped* onto a path and sends a soft ripple:
the moment a file arrives at the handoff point. Friendly, calm, instantly
readable.

## Boundaries

- Personal tool, not a team product. No accounts for recipients.
- 文件始终以附件形式下载，不在应用内预览。
- Browser + PWA only.
