// Permissions are fixed in code: each screen and action checks one of these. Which roles hold which permissions is
// data (role_permission), edited by an Admin on Admin > Roles. A permission is held for everything ("all") or, where
// the code knows how to limit it, only for the person's own records ("own": a technician's own visits).
// docs/ROLES.md explains the defaults.

export interface PermissionDef { key: string; area: string; label: string; help?: string; own?: boolean; locked?: boolean }

export const PERMISSIONS = [
  { key: 'property.view', area: 'Properties', label: 'See properties, units and unit history' },
  { key: 'property.edit', area: 'Properties', label: 'Add and edit properties, WA Notes and units' },
  { key: 'import.run', area: 'Imports & audits', label: 'Import reports (and the import wizard)' },
  { key: 'import.maps', area: 'Imports & audits', label: 'Save and retire import maps' },
  { key: 'audit.review', area: 'Imports & audits', label: 'Review audits: change a recommendation, exports, low battery report' },
  { key: 'job.view', area: 'Jobs', label: 'See jobs, visits and After Action Reports', own: true, help: 'Own: only jobs and visits the person worked on.' },
  { key: 'job.manage', area: 'Jobs', label: 'Create and edit jobs, attach audits, close finished jobs' },
  { key: 'job.override', area: 'Jobs', label: 'Close a job early, reopen a job' },
  { key: 'document.view', area: 'Documents', label: 'See WAs, Proposals and RFMs; the Today queues' },
  { key: 'document.draft', area: 'Documents', label: 'Draft and edit WAs, Proposals and RFMs' },
  { key: 'document.issue', area: 'Documents', label: 'Issue a document version' },
  { key: 'clauses.edit', area: 'Documents', label: 'Edit the standard clauses' },
  { key: 'visit.record', area: 'Field', label: 'Record service visits and photos', own: true, help: 'Own: recording from the unit page in the field.' },
  { key: 'notes.approve', area: 'Field', label: 'Approve client notes' },
  { key: 'service.correct', area: 'Field', label: 'Correct or void recorded service' },
  { key: 'idupdate.manage', area: 'Field', label: 'ID updates: export the workbook, confirm with the billing system' },
  { key: 'price.view', area: 'Billing', label: 'See prices and money' },
  { key: 'price.edit', area: 'Billing', label: 'Edit the catalog, property prices and prices on documents' },
  { key: 'invoice.manage', area: 'Billing', label: 'Invoicing sheets, submissions and invoice references' },
  { key: 'equipment.edit', area: 'Equipment & lists', label: 'Edit the equipment registry' },
  { key: 'lists.edit', area: 'Equipment & lists', label: 'Edit lists such as service codes' },
  { key: 'rules.edit', area: 'Equipment & lists', label: 'Change rules and thresholds (Admin > Settings)' },
  { key: 'users.manage', area: 'Admin', label: 'Add users, reset passwords, give people roles', locked: true },
  { key: 'roles.manage', area: 'Admin', label: 'Change roles and this permission grid', locked: true },
  { key: 'settings.system', area: 'Admin', label: 'Backups and system settings' },
  { key: 'activity.view', area: 'Admin', label: 'See the activity log' },
] as const satisfies readonly PermissionDef[];

export type Permission = (typeof PERMISSIONS)[number]['key'];
export type Scope = 'all' | 'own';
export const isPermission = (k: string): k is Permission => PERMISSIONS.some((p) => p.key === k);

export const BUILTIN_ROLES = [
  { key: 'admin', name: 'Admin', description: 'Technical: users, roles, settings, backups. Few people.' },
  { key: 'manager', name: 'Manager', description: 'Over Coordinators and Technicians; approvals, prices, inventory.' },
  { key: 'coordinator', name: 'Coordinator', description: 'Operations: audits, documents, jobs, equipment and property information, ID updates.' },
  { key: 'scheduler', name: 'Scheduler', description: 'Schedules work and technicians; sometimes in the field; helps with inventory.' },
  { key: 'technician', name: 'Technician', description: 'In the field: their own visits and unit history. Never sees prices.' },
  { key: 'billing', name: 'Billing', description: 'Invoicing, prices and invoice references; sees operations read-only.' },
] as const;

/** The default grid (docs/ROLES.md). Migration 027 seeds the same rows; a test keeps the two equal. */
export const DEFAULT_GRID: Record<string, Partial<Record<Permission, Scope>>> = {
  admin: { 'property.view': 'all', 'import.maps': 'all', 'job.view': 'all', 'lists.edit': 'all', 'rules.edit': 'all',
    'users.manage': 'all', 'roles.manage': 'all', 'settings.system': 'all', 'activity.view': 'all' },
  manager: { 'property.view': 'all', 'property.edit': 'all', 'import.run': 'all', 'import.maps': 'all', 'audit.review': 'all',
    'job.view': 'all', 'job.manage': 'all', 'job.override': 'all', 'document.view': 'all', 'document.draft': 'all', 'document.issue': 'all',
    'clauses.edit': 'all', 'visit.record': 'all', 'notes.approve': 'all', 'service.correct': 'all', 'idupdate.manage': 'all',
    'price.view': 'all', 'price.edit': 'all', 'invoice.manage': 'all', 'equipment.edit': 'all', 'lists.edit': 'all', 'rules.edit': 'all', 'activity.view': 'all' },
  coordinator: { 'property.view': 'all', 'property.edit': 'all', 'import.run': 'all', 'import.maps': 'all', 'audit.review': 'all',
    'job.view': 'all', 'job.manage': 'all', 'document.view': 'all', 'document.draft': 'all', 'document.issue': 'all', 'clauses.edit': 'all',
    'visit.record': 'all', 'notes.approve': 'all', 'idupdate.manage': 'all', 'price.view': 'all', 'equipment.edit': 'all' },
  scheduler: { 'property.view': 'all', 'job.view': 'all', 'document.view': 'all', 'visit.record': 'all', 'price.view': 'all' },
  technician: { 'property.view': 'all', 'job.view': 'own', 'visit.record': 'own' },
  billing: { 'property.view': 'all', 'job.view': 'all', 'document.view': 'all', 'price.view': 'all', 'price.edit': 'all', 'invoice.manage': 'all' },
};

/** Today's four roles map onto the new ones so nobody loses anything they can do (docs/ROLES.md). */
export const LEGACY_ROLES: Record<string, string[]> = { admin: ['admin', 'manager'], office: ['coordinator', 'billing'], coordinator: ['coordinator'], technician: ['technician'] };

/** Anyone holding one of these sees the Admin menu (each Admin section checks its own permission). */
export const ADMIN_AREA: Permission[] = ['users.manage', 'roles.manage', 'settings.system', 'rules.edit', 'activity.view', 'lists.edit', 'import.maps'];
