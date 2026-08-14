# Phase 11 - End-to-End Encryption (Independent Design)

## Status

**Design only.** Per `tasks/phase-11-e2ee.md`, an independent cryptographic
design must be created and approved before changing any upload or download
implementation. **Never add E2EE opportunistically.** This document is that
design; it is **not** an implementation task.

## Threat model

- The Drop server (Cloudflare Worker + D1 + R2) is **not trusted with file
  content**: it may only see ciphertext, encrypted metadata, and what is
  required to route/limit access (object keys, sizes of ciphertext,
  expiry/quota).
- Clients are trusted: keys never leave the owner's devices.
- Goal: confidentiality of file content and (ideally) filenames against a
  server compromise. Not a goal: metadata privacy against the network
  operator (R2 sees object sizes/timing).

## Cryptographic primitives (Web Crypto)

- **AES-256-GCM** for content encryption (authenticated).
- **PBKDF2-SHA-256** for password-derived key wrapping (owner master key),
  with per-user random salt + high iteration count; or a random master key
  stored client-side (keychain) when no passphrase is set.
- **Per-file data key**: each file gets a random 256-bit data key; the data
  key is wrapped (encrypted) with the master key and stored as encrypted
  metadata. This enables per-file revocation and sharing without re-encrypting
  content.
- Random 96-bit IV per encryption operation; never reuse (key, IV) pairs.

## Multipart framing

- Content is split into fixed-size plaintext chunks (e.g. 4 MiB) matching the
  upload part grid; each chunk is encrypted separately
  (`AES-GCM(dataKey, iv_i, chunk_i)`) so part upload/resume stays valid.
- Each part's ciphertext includes: `partNumber`, `iv`, and ciphertext; a
  per-file `header` blob holds the wrapped data key, chunk size, plaintext
  size, and MACs — stored as encrypted metadata in D1 (or in the first part).
- **Size disclosure**: R2 sees ciphertext sizes (~= plaintext + 16 bytes
  GCM tag per chunk). Padding is out of scope initially.

## Downloads & ranges

- Range requests operate on **ciphertext offsets**; the client maps the
  requested plaintext range to (chunk index, ciphertext range), fetches the
  covering ciphertext chunks, decrypts, and serves the plaintext slice to the
  caller. `Content-Range` on the wire reflects ciphertext — the client must
  translate before exposing a plaintext API.
- The public share download pipeline (Phase 04 `buildDownloadResponse`)
  cannot stream decrypted content server-side (the server has no key); share
  downloads for encrypted files are client-side (the browser decrypts) or
  E2EE shares carry the wrapped data key in the share link — **share E2EE is a
  distinct sub-design** (link carries `?key=<wrapped>`; plaintext URL hygiene).

## Metadata exposure model

| Field | Cleartext (needed to run) | Encrypted |
| --- | --- | --- |
| object key | yes (routing) | — |
| ciphertext size | yes (R2) | — |
| original filename | no | yes (in encrypted header) |
| mime type | no | yes |
| upload/share tokens | hashes | — |
| expiry/quota | yes | — |

## Impact map (what an implementation phase must touch)

- Upload session creation: accept an `encrypted` flag + header blob.
- Part upload: content is already ciphertext — the server treats it
  opaquely; only sizes/MAC bookkeeping changes.
- Completion: store the encrypted header; `files.original_name`/`mime_type`
  become ciphertext-holding columns (or move into the header blob).
- Listing: names are encrypted → the owner UI decrypts client-side.
- Download (owner + share): client-side decryption layer; range translation.
- Share links: wrapped data key handling + revocation semantics.
- Incoming uploads (Phase 08): Turnstile + E2EE coexist — the uploader
  encrypts client-side before upload; the owner holds the key.

## Explicitly out of scope

- Server-side key escrow, password recovery, multi-device key sync without
  user passphrase, deniable storage, post-quantum algorithms.

## Approval gate

Implementing E2EE requires: (1) this design approved, (2) a phased
`tasks/phase-11-e2ee.md` implementation plan (start with
encrypt-metadata + client-side encrypt/decrypt of single uploads, then
multipart framing, then ranges/shares), and (3) migration of existing
plaintext files decided explicitly (mixed-mode storage or one-time re-upload).
Do not modify any upload/download code before approval.
