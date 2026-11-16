# Ivory Dental PostgreSQL Migration — Phase 1

This is a **migration workspace**, not a production-ready PostgreSQL backend. Existing routes, controllers, and services have been copied from the supplied `ivory.zip` archive. The legacy Google Sheets and Excel persistence remains active until each service is converted and verified. **Do not point this project at production clinic data yet.**

## Preserved routing

`server.js` still mounts `routes/index.js` at `/api` and SMS at `/api/sms`. Existing route files and controllers are unchanged. The PostgreSQL connection is provided in `config/database.js` but is **not yet used** by legacy services.

## Setup

1. Create a **development** Supabase project and obtain the PostgreSQL connection string.
2. Copy `.env.example` to `.env`, set `DATABASE_URL` (do not commit `.env`).
3. Run `npm install` and `npm run db:generate`.
4. Review `prisma/schema.prisma` before running `npm run db:migrate`: the Patient model is an **initial draft**, not the complete approved schema.
5. Inventory and migrate services one by one, preserving exact API behavior and validating data before any production cutover.

## Important

- `TreatmentPayments` is the chosen active payment sheet; its code is in `services/simplePayment.service.js`. The other payment endpoints remain in place for compatibility until usage is audited.
- `server.js` still calls `ensureDatabase()` from the Excel utility; remove this only after the corresponding queue functionality is migrated.
- `credentials.json` and development secrets are intentionally excluded from this archive. Rotate any credentials exposed elsewhere.
- No patient data or spreadsheet export is included.
- All payment migration work must preserve exact money amounts, IDs, and payment history and reconcile totals.
