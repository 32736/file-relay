# Security

## Trust boundaries

The Worker authorizes every D1 and R2 operation. The R2 bucket is private, and
the browser never receives infrastructure credentials. Production secrets are
stored with Wrangler secrets and are not committed, logged, or included in
test fixtures.

## Authentication and tokens

- GitHub OAuth identifies the sole owner by numeric GitHub user ID.
- OAuth callbacks validate a cryptographically random state value.
- Security tokens use Web Crypto random bytes and base64url encoding.
- D1 stores one-way hashes or keyed MACs, never raw session, share, or upload
  access tokens.
- Owner sessions use a `__Host-` HttpOnly, Secure, SameSite=Lax cookie.
- Cookie-authenticated state changes validate the request Origin.

## File safety

Original filenames are metadata only and never become R2 object keys. Downloads
default to attachment with `nosniff`; user-controlled HTML, SVG, and XHTML are
never rendered inline on the application origin. Response header filenames
must be encoded by a shared, tested helper in the phase that adds downloads.

## Phase 00

The health endpoint reveals only a boolean readiness response. It does not
expose environment values or probe production data. Phase 00 defines D1 and R2
bindings but performs no file or database operations.
