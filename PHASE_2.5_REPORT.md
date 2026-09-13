# SYJ-HCM Phase 2.5 — Offers & Offer Management

**Target release:** `v0.14.0-alpha`
**Base:** `9815056`
**Migration:** `0009_phase2_5_offer_management.sql`

Phase 2.5 extends the existing ATS application lifecycle with tenant-scoped offers, structured compensation, controlled approvals, immutable sent terms, revisions, candidate response tokens, expiration, private offer documents, and a clean onboarding handoff through the existing `hired` application state.

### Architecture

- Offers are children of existing ATS applications; no parallel candidate lifecycle was introduced.
- Eligibility is server-enforced: application must be in `evaluation`, its requisition must be open, and no active offer may exist.
- Money is represented as integer minor units; no floating-point arithmetic is used by the offer service.
- Active-offer uniqueness is enforced by SQLite partial unique index.
- Lifecycle transitions are protected by a database trigger and server-side transition matrix.
- Approved/sent/terminal commercial terms are immutable. Revisions create a new offer row with incremented version and `supersedes_offer_id`.
- Approval uses the existing HR/Admin user model and enforces separation of duties: the creator cannot approve or reject their own offer.
- Candidate response uses a 32-byte random bearer token; only its SHA-256 hash is stored. Tokens expire, are revocable, single-use, and rate-limited.
- Acceptance transitions the existing application from `offer` to `hired`, providing the Phase 3 onboarding handoff without creating an employee automatically.
- Offer letters are generated as real text documents from persisted offer data and stored through the existing Phase 2.3 private document service. No fake email delivery is claimed.
- Public careers remains isolated; no offer data is added to public job/application DTOs.

### Email boundary

The repository does not contain a production email provider. Sending an offer means a controlled internal transition to `sent` and issuance of a secure candidate response link; it does **not** claim that an email was delivered.
