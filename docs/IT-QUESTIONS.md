# Questions for IT

Full list with ideal and assumed answers: the "Service Platform — Questions for IT" doc (Claude Docs). These are the decisions that block a pilot.

1. **Where will it run?** Company-managed server or cloud tenant, or a machine the team runs? Who deploys and patches it?
2. **Which managed PostgreSQL** will hold the data, and can the `pgvector` extension be enabled?
3. **Read-only Salesforce service account** (connected app limited to Case, Work Order and Account)?
4. **Approved embeddings service** in our own tenant for semantic search, if semantic search is wanted? (The workflow itself uses no AI. Search by exact words works without it, so this can be declined.)
5. **Is built-in email + password sign-in acceptable** for about four users, with SSO later?

Added by Service Notes:
6. (Answered: no AI is used in the live workflow, so no AI data terms are needed for service notes.)
7. Where are photos stored (database or object storage), and for how long?
8. How should the ID update file reach the billing system (UBS)? File hand-off today; is there an import or API?

What the app is: Next.js 15 / React 19 on Node 22, one process, no background workers. PostgreSQL (standard SQL; optional `pg_trgm`, `pgvector`). About 4 internal users. Holds property and unit addresses, meter/transmitter IDs, prices, service notes, uploaded reports (180 days). Holds no resident names, contact details or payment data. No outbound calls today.
