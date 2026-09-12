# Candidate Document Storage Operations

## Development

Candidate documents use private local filesystem storage by default:

```dotenv
DOCUMENT_STORAGE_PATH=./data/storage
DOCUMENT_SCANNER_MODE=unavailable
```

Do not place this directory below `public/`. Do not commit it. The repository `.gitignore` excludes local storage and database runtime data.

## Security model

The browser never chooses the storage key. The server generates a random opaque key and stores it only as internal metadata. The candidate name, original filename and other PII are not used as filesystem paths.

Authorization happens before a storage key is resolved. Downloads are authenticated and tenant-scoped and return private, non-cacheable attachment responses.

## Scanner state

The bundled scanner adapter is intentionally `scanner_unavailable`. It does not claim that an uploaded file is malware-free. A production scanner should implement the `MalwareScanner` interface and return explicit states such as `clean`, `infected`, `scan_failed`, or `scanner_unavailable`.

## Backup

A production backup must cover both:

1. the SQLite database, including `candidate_documents` metadata and audit records; and
2. the private document storage.

Restoring only the database can create missing document objects. Restoring only the storage can create orphan objects. Run the reconciliation script after restoration:

```bash
npx tsx scripts/reconcile-document-storage.ts
```

The script is reporting-only; it does not delete files automatically.

## Object storage migration

The domain depends on the `DocumentStorage` contract rather than a vendor SDK. An S3-compatible implementation can be introduced later without exposing signed/public URLs to clients. Authorization remains an application responsibility before storage access.

No cloud credentials are required for local development.
