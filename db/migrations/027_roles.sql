-- Roles and permissions as data (docs/ROLES.md). Permissions are fixed in code (src/auth/permissions.ts); which
-- role holds which is edited on Admin > Roles. A person can hold several roles.
CREATE TABLE role (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text NOT NULL,
  description text,
  builtin boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 100,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE role_permission (
  role_key text NOT NULL REFERENCES role(key),
  permission text NOT NULL,
  scope text NOT NULL DEFAULT 'all' CHECK (scope IN ('all','own')),
  PRIMARY KEY (role_key, permission)
);
CREATE TABLE user_role (
  user_id uuid NOT NULL REFERENCES app_user(id),
  role_key text NOT NULL REFERENCES role(key),
  PRIMARY KEY (user_id, role_key)
);
INSERT INTO role (key,name,description,builtin,sort) VALUES
  ('admin','Admin','Technical: users, roles, settings, backups. Few people.',true,1),
  ('manager','Manager','Over Coordinators and Technicians; approvals, prices, inventory.',true,2),
  ('coordinator','Coordinator','Operations: audits, documents, jobs, equipment and property information, ID updates.',true,3),
  ('scheduler','Scheduler','Schedules work and technicians; sometimes in the field; helps with inventory.',true,4),
  ('technician','Technician','In the field: their own visits and unit history. Never sees prices.',true,5),
  ('billing','Billing','Invoicing, prices and invoice references; sees operations read-only.',true,6);
INSERT INTO role_permission (role_key,permission,scope) VALUES
  ('admin','property.view','all'),
  ('admin','import.maps','all'),
  ('admin','job.view','all'),
  ('admin','lists.edit','all'),
  ('admin','rules.edit','all'),
  ('admin','users.manage','all'),
  ('admin','roles.manage','all'),
  ('admin','settings.system','all'),
  ('admin','activity.view','all'),
  ('manager','property.view','all'),
  ('manager','property.edit','all'),
  ('manager','import.run','all'),
  ('manager','import.maps','all'),
  ('manager','audit.review','all'),
  ('manager','job.view','all'),
  ('manager','job.manage','all'),
  ('manager','job.override','all'),
  ('manager','document.view','all'),
  ('manager','document.draft','all'),
  ('manager','document.issue','all'),
  ('manager','clauses.edit','all'),
  ('manager','visit.record','all'),
  ('manager','notes.approve','all'),
  ('manager','service.correct','all'),
  ('manager','idupdate.manage','all'),
  ('manager','price.view','all'),
  ('manager','price.edit','all'),
  ('manager','invoice.manage','all'),
  ('manager','equipment.edit','all'),
  ('manager','lists.edit','all'),
  ('manager','rules.edit','all'),
  ('manager','activity.view','all'),
  ('coordinator','property.view','all'),
  ('coordinator','property.edit','all'),
  ('coordinator','import.run','all'),
  ('coordinator','import.maps','all'),
  ('coordinator','audit.review','all'),
  ('coordinator','job.view','all'),
  ('coordinator','job.manage','all'),
  ('coordinator','document.view','all'),
  ('coordinator','document.draft','all'),
  ('coordinator','document.issue','all'),
  ('coordinator','clauses.edit','all'),
  ('coordinator','visit.record','all'),
  ('coordinator','notes.approve','all'),
  ('coordinator','idupdate.manage','all'),
  ('coordinator','price.view','all'),
  ('coordinator','equipment.edit','all'),
  ('scheduler','property.view','all'),
  ('scheduler','job.view','all'),
  ('scheduler','document.view','all'),
  ('scheduler','visit.record','all'),
  ('scheduler','price.view','all'),
  ('technician','property.view','all'),
  ('technician','job.view','own'),
  ('technician','visit.record','own'),
  ('billing','property.view','all'),
  ('billing','job.view','all'),
  ('billing','document.view','all'),
  ('billing','price.view','all'),
  ('billing','price.edit','all'),
  ('billing','invoice.manage','all');

-- Everyone keeps what they could do: admin -> Admin + Manager, office -> Coordinator + Billing.
INSERT INTO user_role (user_id, role_key)
SELECT u.id, m.role_key FROM app_user u
  JOIN (VALUES ('admin','admin'),('admin','manager'),('office','coordinator'),('office','billing'),('coordinator','coordinator'),('technician','technician')) m(old, role_key)
    ON m.old = u.role;
-- The old single role is no longer read; kept for the record only.
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_role_check;
ALTER TABLE app_user ALTER COLUMN role DROP NOT NULL;
