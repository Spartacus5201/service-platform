# Salesforce setup (for the Salesforce administrator)

The Service Platform only reads from Salesforce. Do this in a sandbox first, then repeat in production. Menu names can differ slightly by release.

1. **Environment.** Send us the My Domain URL (for example `https://yourcompany.my.salesforce.com`) and the API version to use.
2. **Integration user.** Create one user for this app only, with the Salesforce Integration license and the Salesforce API Only System Integrations profile. Not an admin or a person's account.
3. **Permission set (read-only).** Create `Service Platform Read Only` and assign it to that user.
   - System permission: **API Enabled**.
   - Object permissions: **Read only** on Case, Work Order and Account. No Create, Edit or Delete. Nothing else.
   - Field permissions: Read on the fields in step 6.
   - Sharing: grant **View All** on those three objects, or confirm sharing lets the user see every record we need.
4. **External Client App** (Connected Apps can no longer be created).
   - Setup > External Client Apps > new, named `Service Platform`.
   - Enable OAuth. Callback URL: a placeholder such as `https://localhost` (the form requires one; this flow does not use it).
   - Scope: Manage user data via APIs (`api`).
   - Enable the **Client Credentials Flow** and set the app's **Run As** user to the integration user. (Alternative: JWT bearer flow with a certificate we supply.)
   - Policies: only users authorized by permission set or profile may use the app; authorize the permission set from step 3. Add an IP restriction for our server once known.
5. **Send back through the company's secret store** (not email or chat): consumer key and secret (or key + username + certificate for JWT), and the My Domain URL.
6. **Fields (exact API names).** Case: number, status, subject, account link, created/closed dates. Work Order: number, status, case link, service date. Account: name and the field holding our Class ID / property number. Also the allowed status values for Case and Work Order, and anything else a record links to that we should show (contract, billing reference).
7. **Limits and ownership.** The org's daily API limit (we expect a few hundred calls a day). One named admin who owns the integration if fields or statuses change. To disable quickly: deactivate the integration user.

**Check:** in the sandbox, try to edit a Case as the integration user. It must be refused.

## Turning it on in Service Platform
Set these on the server (never in the repository):
```
SF_MODE=live
SF_DOMAIN=https://yourcompany.my.salesforce.com
SF_CLIENT_ID=<consumer key>
SF_CLIENT_SECRET=<consumer secret>
SF_API_VERSION=62.0
```
`SF_MODE=mock` uses built-in sample cases (the demo does this); `off` (default) means no lookups. The app only signs in and runs read-only queries: Case number, status, subject, account, and the case's work orders (number, status, start date). On a job, "Refresh status from Salesforce" copies that status onto the job and warns if the case belongs to a different account than the property.

## What the app does and does not pull
- It never lists, imports or syncs cases. It reads exactly one case, the number typed on a job, and only when someone presses "Refresh status from Salesforce" (or creates a job with a case number).
- What it keeps from that case is one line of text on the job (status and latest work order). Nothing else is stored.
- It never writes to Salesforce. Anything that must change in Salesforce is still done in Salesforce.
