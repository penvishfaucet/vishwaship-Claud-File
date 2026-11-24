/**
 * Staff role -> permission matrix. Checked on the server for pages, APIs, exports, documents and
 * jobs. Customers have no staff permissions; they are confined to their own org by tenant scoping.
 */
export type StaffRole = "owner" | "operations" | "finance" | "support" | "readonly";

export type Permission =
  | "shipments.read" | "shipments.write" | "shipments.cost.read"
  | "customers.read" | "customers.write" | "kyc.review" | "kyc.documents.read"
  | "pricing.read" | "pricing.write"
  | "finance.read" | "finance.adjust" | "cod.remit"
  | "tickets.read" | "tickets.write"
  | "integrations.read" | "integrations.write"
  | "notifications.read" | "notifications.write"
  | "reports.export"
  | "staff.manage" | "audit.read" | "api_keys.manage" | "customers.impersonate"
  | "modules.manage" | "content.write";

const ALL: Permission[] = [
  "shipments.read", "shipments.write", "shipments.cost.read", "customers.read", "customers.write", "kyc.review",
  "kyc.documents.read", "pricing.read", "pricing.write", "finance.read", "finance.adjust", "cod.remit", "tickets.read",
  "tickets.write", "integrations.read", "integrations.write", "notifications.read", "notifications.write",
  "reports.export", "staff.manage", "audit.read", "api_keys.manage", "customers.impersonate", "modules.manage", "content.write",
];

export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  owner: ALL,
  operations: [
    "shipments.read", "shipments.write", "customers.read", "kyc.review", "kyc.documents.read",
    "tickets.read", "tickets.write", "integrations.read", "notifications.read", "notifications.write", "reports.export", "content.write",
  ],
  finance: [
    "shipments.read", "shipments.cost.read", "customers.read", "pricing.read", "pricing.write",
    "finance.read", "finance.adjust", "cod.remit", "reports.export", "audit.read",
  ],
  support: ["shipments.read", "customers.read", "tickets.read", "tickets.write", "notifications.read"],
  readonly: ["shipments.read", "customers.read", "tickets.read", "pricing.read", "finance.read", "integrations.read", "notifications.read"],
};

export const can = (role: StaffRole | null | undefined, p: Permission) => !!role && ROLE_PERMISSIONS[role].includes(p);

/**
 * Roles that must complete an authenticator-app (TOTP) step before any admin access.
 * Empty by the owner's decision (2026-11-24): staff sign in with password, Google, or mobile OTP (Firebase), no authenticator app.
 */
export const MFA_REQUIRED: StaffRole[] = [];
