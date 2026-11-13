-- Document numbers start with the invoicing code: 262000000 = property under install warranty, 262000001 = installed by us,
-- out of warranty, no billing contract, otherwise the property's ClassID. Charge code: 20 Billable, 21 MSA, 23 Installation Warranty.
ALTER TABLE property ADD COLUMN billing_contract boolean NOT NULL DEFAULT true;
ALTER TABLE document ADD COLUMN charge_code text CHECK (charge_code IN ('20','21','23'));
