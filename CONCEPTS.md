# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Mandates and ledgers

### Mandate
A parent's spending rule for an AI shopping agent, held as a signed, structured record. It states a weekly budget, the categories the agent may buy, the categories it must never buy, and optionally a unit price above which the parent must approve first. It also lists any part of the parent's wording that the system cannot enforce.

Every checkout is judged against the signed mandate that the server loads and verifies, never against rule text supplied by the model or the browser.

### Mandate version
One signed snapshot of a ledger's mandate. Versions are only added, never edited: signing a changed rule adds one, and so does signing the demo mandate again after the server's signing key changed. The latest version is the one in force, and each checkout attempt records which version it was judged against.

### Ledger
The record of one household's checkout attempts, held against that household's mandate versions. The demo parent has one ledger. Each visitor gets a private ledger, found through a random cookie, that starts with a copy of the demo parent's current mandate. Visitors do not see one another's attempts in the spend log.

### Signing key
The key the server uses to sign mandates, derived from one server secret. The server accepts only mandates signed by its own key, so every server that reads the same ledgers must derive the same key.
