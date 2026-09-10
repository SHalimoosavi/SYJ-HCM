# Phase 1.1 Bundle Notice

This archive contains the complete Phase 1 application source tree used for the hardening pass.

The authoritative repository baseline is GitHub `main` at:

`030168a6b5c2952933e371ad31e6878fb2391921`

The GitHub integration available during this build is read-only and the build container has no outbound network access. Therefore the repository's existing `package-lock.json` was not re-downloaded into this archive. **Do not delete the lockfile in your existing `~/syj-hcm` clone.**

Recommended use in Termux: extract this archive over a clean clone/working copy of `main` while preserving its `.git/` directory and `package-lock.json`, then run `scripts/verify-phase1-1.sh`.

If this archive is used as a standalone source directory instead, run `npm install` once to generate a lockfile before using `npm ci`; the dependency versions in `package.json` remain the Phase 1.0/1.1 validated versions.

No Phase 2 Recruiting/ATS/Onboarding code is included.
