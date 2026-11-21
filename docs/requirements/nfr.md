# Non-Functional Requirements — v9.0 addendum (Ta08e-req)

**Task:** `Ta08e-req` · **Correlation:** `a08e7d90-26e9-4f01-b9be-b3421a4b41e0` · **Capability:** `req.spec`

NFR-P1, NFR-S1, NFR-A1, NFR-I1 and NFR-C1 are carried forward unchanged from `docs/requirements/spec.md` section 6. NFR-A2 and NFR-S2 are additive for the v9.0 toggle and UI-merge scope. Every target carries a number with a unit, and every paragraph passes the ambiguity scan.

## Perf

- **NFR-P1** (perf): realm up reaches active within 200 s on the 5.7.1 realm stack, and control-socket reads return within 10 s; 1 response. verified_by: A08.live.

## Security

- **NFR-S1** (security): under fail-closed, disconnected host edit and Realm write calls return 0 successes; control socket directory mode 0700 with socket mode 0600; scanner output holds 0 secrets. verified_by: A08.security.
- **NFR-S2** (security): with the plugin toggle off, Realm tools registered equal 0 and Realm paints equal 0; with the toggle on, Realm tools registered equal 5. verified_by: A08.

## A11y

- **NFR-A1** (a11y): the status shows exactly 1 of 2 text labels with a color-independent cue; both labels stay distinguishable without color. verified_by: A08.
- **NFR-A2** (a11y): Realm status renders in 1 additional-UI region with 0 paints to the under-bar status key, and painted text matches the daemon snapshot in 4 of 4 states. verified_by: A08.

## I18n

- **NFR-I1** (i18n): every result code matches the frozen catalogue in C and en_US locales, and 0 code paths parse locale-formatted numbers; operator text is English. verified_by: A08.

## Compliance

- **NFR-C1** (compliance): off-machine telemetry calls equal 0, audit and log PII fields equal 0 with 1 redaction sentinel present, and AGPL-3.0-only licensing is preserved. verified_by: A08/A10.
