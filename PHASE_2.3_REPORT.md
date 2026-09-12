# SYJ-HCM Phase 2.3 — Candidate Documents & Resume Management

**Release:** v0.12.0-alpha
**Phase:** 2.3
**Migration:** `0007_phase2_3_candidate_documents.sql`

## Scope delivered

- Tenant-scoped candidate document metadata in SQLite; binaries remain outside SQLite.
- Private local filesystem storage behind a `DocumentStorage` abstraction.
- Opaque random storage keys independent of candidate names and document IDs.
- Candidate-level and application-specific document views.
- Controlled document types: resume, cover letter, certificate, portfolio, other.
- Server-side 12 MiB maximum size limit.
- Filename normalization against traversal, control characters, absolute/path-like input and dangerous punctuation.
- Content-signature validation for PDF, DOCX, legacy DOC, TXT and safe raster image formats.
- SVG, HTML/active markup, arbitrary ZIP and executable signatures are rejected.
- Declared MIME must agree with detected content when supplied.
- SHA-256 checksum recorded for every accepted upload.
- Malware-scanning abstraction with an explicit `scanner_unavailable` state. The implementation does **not** claim that files are virus-free without an AV engine.
- Authorized download endpoint only; no public static URLs, no raw storage keys, private/no-store caching, `nosniff`, and attachment disposition.
- Archive/restore lifecycle and non-destructive replacement: a replacement is a new document record and the previous record is archived.
- Candidate/application ownership is tenant-bound at the database and service layers, including a database guard preventing an application from being attached to the wrong candidate.
- HR/admin-only document access; ordinary employees and interview participants do not inherit document access.
- Upload/download/archive/restore/replacement/denial audit events without document contents or credentials.
- Storage reconciliation script that reports orphan files without deleting them automatically.
- Retention foundation fields (`retention_until`, `legal_hold`, archive/delete timestamps) without implementing an autonomous retention engine.

## Lifecycle

```text
upload request
   -> authenticated HR/admin check
   -> server-side size/name/type validation
   -> content detection
   -> private storage write
   -> scanner abstraction
      -> clean / scanner_unavailable / rejected states
   -> metadata record
   -> available or failed
   -> archive / restore / replacement later
```

The local scanner adapter returns `scanner_unavailable`. This is deliberate: no malware protection is represented as active until a real scanner adapter is deployed. The storage abstraction is designed so a future ClamAV or S3-compatible implementation can be added without changing the document domain model.

## Storage and deployment

Development defaults to:

```dotenv
DOCUMENT_STORAGE_PATH=./data/storage
DOCUMENT_SCANNER_MODE=unavailable
```

`data/storage` is ignored by Git and is never placed under Next.js `public/`. Production deployments must provision private persistent document storage and backup it together with the SQLite database. If object storage is introduced, the adapter boundary should preserve the same `put/get/delete/exists/metadata` contract and authorization must remain in SYJ-HCM before storage resolution.

No encryption-at-rest claim is made by this phase. Production encryption must be supplied by the host filesystem/storage platform and verified operationally.

## Validation commands

The intended repository verification gates are:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

The build environment used for this handoff could not complete `npm ci`: external npm package retrieval was unavailable and the local npm cache was empty. Consequently, `typecheck`, the full test suite, production build, and audit could not be honestly reported as executed successfully in this environment. The Phase 2.3 migration itself was executed directly with Node's built-in SQLite engine across migrations 0000–0007 and passed schema creation plus tenant/application/immutability checks.

## Security review focus

- IDOR: document queries are always scoped to the authenticated organization and HR/admin role.
- Tenant escape: candidate/application/uploader relations use composite tenant-aware foreign keys.
- Path traversal: storage keys are server-generated and validated against a strict opaque-key grammar.
- Upload bypass: browser filename, MIME and size are treated as untrusted and content signatures are checked server-side.
- Active content: SVG/HTML/script-like markup is rejected; downloads are forced to attachment disposition.
- Header injection: content-disposition filenames are sanitized and encoded.
- Storage enumeration: no public listing endpoint exists and keys are random.
- Resource exhaustion: server action body limit and a 12 MiB document ceiling bound upload payloads.
- Cross-system consistency: storage is written before metadata and cleaned on DB failure; reconciliation reports remaining orphans.
