/**
 * Vishwaship schema. Money = bigint paise (mode "number"; safe up to ~9e13 rupees).
 * Percentages = integer basis points. Weights = integer grams. Dimensions = integer millimetres.
 * Every tenant-owned table carries org_id; queries go through tenant-scoped helpers.
 */
import { sql } from "drizzle-orm";
import {
  customType,
  bigint, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey();
const ts = (n: string) => timestamp(n, { withTimezone: true });
const created = () => ts("created_at").notNull().default(sql`now()`);
const paise = (n: string) => bigint(n, { mode: "number" });

// ---------- identity ----------
export const staffRole = pgEnum("staff_role", ["owner", "operations", "finance", "support", "readonly"]);
export const kycStatus = pgEnum("kyc_status", ["not_started", "pending", "approved", "changes_requested", "rejected"]);

export const orgs = pgTable("orgs", {
  id: id(),
  name: text("name").notNull(),
  businessName: text("business_name").notNull(),
  gstin: text("gstin"),
  expectedMonthlyVolume: text("expected_monthly_volume"),
  status: text("status").notNull().default("active"), // active | suspended
  kycStatus: kycStatus("kyc_status").notNull().default("not_started"),
  bankAccountMasked: text("bank_account_masked"),
  bankIfsc: text("bank_ifsc"),
  /** Complete Your Profile: { line1, line2, city, state, pincode }. */
  address: jsonb("address"),
  profileCompletedAt: ts("profile_completed_at"),
  /** Franchise this customer belongs to (signed up via its referral link, or linked by an admin). */
  franchiseId: text("franchise_id"),
  franchiseLinkedAt: ts("franchise_linked_at"),
  /** referral | admin */
  franchiseLinkSource: text("franchise_link_source"),
  createdAt: created(),
}, (t) => [index("orgs_franchise").on(t.franchiseId)]);

export const users = pgTable("users", {
  id: id(),
  kind: text("kind").notNull(), // customer | staff | franchise
  orgId: text("org_id").references(() => orgs.id), // null for staff
  name: text("name").notNull(),
  email: text("email"),
  mobile: text("mobile"),
  emailVerifiedAt: ts("email_verified_at"),
  mobileVerifiedAt: ts("mobile_verified_at"),
  /** Google account id (OpenID "sub") once Continue with Google is linked. */
  googleSub: text("google_sub"),
  passwordHash: text("password_hash"),
  mustResetPassword: boolean("must_reset_password").notNull().default(false),
  staffRole: staffRole("staff_role"),
  mfaSecretEnc: text("mfa_secret_enc"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  active: boolean("active").notNull().default(true),
  /** Per-user UI preferences (e.g. Orders table columns). Never security-relevant. */
  prefs: jsonb("prefs").notNull().default({}),
  createdAt: created(),
}, (t) => [
  uniqueIndex("users_email_kind").on(t.kind, t.email),
  uniqueIndex("users_mobile_kind").on(t.kind, t.mobile),
  uniqueIndex("users_google_sub").on(t.googleSub),
]);

export const sessions = pgTable("sessions", {
  id: id(), // sha256 of the cookie token
  userId: text("user_id").notNull().references(() => users.id),
  createdAt: created(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  mfaPassed: boolean("mfa_passed").notNull().default(false),
  impersonatorId: text("impersonator_id"), // staff user id when an admin uses "Login as customer"
  ip: text("ip"),
  userAgent: text("user_agent"),
});

export const oneTimeTokens = pgTable("one_time_tokens", {
  id: id(), // sha256 of token
  userId: text("user_id").notNull().references(() => users.id),
  purpose: text("purpose").notNull(), // password_setup | password_reset | email_verify | staff_invite
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: created(),
});

export const otpChallenges = pgTable("otp_challenges", {
  id: id(),
  target: text("target").notNull(), // mobile or email
  purpose: text("purpose").notNull(), // login | pickup_mobile | signup
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: ts("expires_at").notNull(),
  verifiedAt: ts("verified_at"),
  createdAt: created(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: ts("window_start").notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: id(),
  actorUserId: text("actor_user_id"),
  actorKind: text("actor_kind").notNull(), // staff | customer | system | api_key
  orgId: text("org_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  details: jsonb("details"),
  createdAt: created(),
}, (t) => [index("audit_org_created").on(t.orgId, t.createdAt)]);

// ---------- KYC ----------
export const kycDocuments = pgTable("kyc_documents", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  docType: text("doc_type").notNull(), // aadhaar | pan | cancelled_cheque | gst_certificate
  storageKey: text("storage_key").notNull(), // private object key, never a public URL
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  maskedNumber: text("masked_number"),
  status: kycStatus("status").notNull().default("pending"),
  reviewerId: text("reviewer_id"),
  reviewReason: text("review_reason"),
  reviewedAt: ts("reviewed_at"),
  createdAt: created(),
});

// ---------- warehouses ----------
export const warehouses = pgTable("warehouses", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  label: text("label").notNull(),
  contactName: text("contact_name").notNull(),
  mobile: text("mobile").notNull(),
  mobileVerifiedAt: ts("mobile_verified_at"),
  line1: text("line1").notNull(),
  line2: text("line2"),
  pincode: text("pincode").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  email: text("email"),
  code: text("code"), // short human ID shown in lists (e.g. W1001)
  active: boolean("active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  createdBy: text("created_by"),
  deactivatedAt: ts("deactivated_at"),
  updatedAt: ts("updated_at"),
  createdAt: created(),
});

/** Courier-side registration is tracked separately from Vishwaship activation. */
export const warehouseProviderSync = pgTable("warehouse_provider_sync", {
  id: id(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  providerAccountId: text("provider_account_id").notNull(),
  providerWarehouseRef: text("provider_warehouse_ref"),
  status: text("status").notNull(), // pending | registered | failed
  lastError: text("last_error"),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [uniqueIndex("wps_wh_acct").on(t.warehouseId, t.providerAccountId)]);

// ---------- providers ----------
export const providerAccounts = pgTable("provider_accounts", {
  id: id(),
  adapter: text("adapter").notNull(), // shipmozo | delhivery_b2c | delhivery_b2b | shiprocket | razorpay | wati | resend | smtp | sms | generic_http
  category: text("category").notNull(), // shipping | payments | messaging | email
  label: text("label").notNull(),
  mode: text("mode").notNull().default("test"), // test | live
  status: text("status").notNull().default("disabled"), // enabled (Active) | disabled (setup / verification) | paused (no new quotes or bookings; tracking continues) | archived
  priority: integer("priority").notNull().default(100),
  configPublic: jsonb("config_public").notNull().default({}), // non-secret settings
  secretsEnc: text("secrets_enc"), // AES-GCM blob; write-only from the UI
  secretsHint: jsonb("secrets_hint"), // masked hints, e.g. {"publicKey":"pk_…9f2a"}
  capabilities: jsonb("capabilities").notNull().default({}), // capability -> verification state
  lastTestAt: ts("last_test_at"),
  lastTestOk: boolean("last_test_ok"),
  lastTestMessage: text("last_test_message"),
  lastSuccessAt: ts("last_success_at"),
  createdAt: created(),
});

// ---------- pricing ----------
export const markupRules = pgTable("markup_rules", {
  id: id(),
  provider: text("provider").notNull(), // "shipmozo"
  orgId: text("org_id"), // null = global default
  bps: integer("bps").notNull(),
  version: integer("version").notNull(),
  effectiveFrom: ts("effective_from").notNull(),
  clearedAt: ts("cleared_at"),
  createdBy: text("created_by"),
  createdAt: created(),
}, (t) => [index("markup_provider_org").on(t.provider, t.orgId)]);

export const pricingSettings = pgTable("pricing_settings", {
  key: text("key").primaryKey(), // gst_bps | b2b_threshold_grams | component_rules
  value: jsonb("value").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
});

/** Public indicative zone rate card (marketing). Never used for booking prices. */
export const publicRateCard = pgTable("public_rate_card", {
  id: id(),
  zone: text("zone").notNull(),
  description: text("description").notNull(),
  firstSlabGrams: integer("first_slab_grams").notNull(),
  firstSlabPaise: paise("first_slab_paise").notNull(),
  additionalSlabGrams: integer("additional_slab_grams").notNull(),
  additionalSlabPaise: paise("additional_slab_paise").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const quotes = pgTable("quotes", {
  id: id(),
  orgId: text("org_id"), // null for public quotes
  providerAccountId: text("provider_account_id"),
  provider: text("provider").notNull(),
  carrierCode: text("carrier_code").notNull(),
  serviceName: text("service_name").notNull(),
  mode: text("mode").notNull(),
  request: jsonb("request").notNull(),
  priced: jsonb("priced").notNull(), // full PricedQuote snapshot incl. cost, markup rule + version
  totalPaise: paise("total_paise").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: created(),
});

// ---------- orders & shipments ----------
export const orders = pgTable("orders", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  orderNumber: text("order_number").notNull(),
  source: text("source").notNull().default("manual"), // manual | bulk | api | shopify | woocommerce | custom | online_store
  externalStoreId: text("external_store_id"),
  externalOrderId: text("external_order_id"),
  status: text("status").notNull().default("draft"),
  // draft | ready | cod_hold | booking | booked | cancelled | booking_failed | needs_reconcile
  mode: text("mode").notNull(), // B2C | B2B
  direction: text("direction").notNull().default("forward"), // forward | reverse
  paymentType: text("payment_type").notNull(), // prepaid | cod
  codAmountPaise: paise("cod_amount_paise").notNull().default(0), // buyer collection, never marked up
  declaredValuePaise: paise("declared_value_paise").notNull(),
  warehouseId: text("warehouse_id").references(() => warehouses.id),
  /** Copy of the pickup address at order time, so later warehouse edits never change history. */
  pickupSnapshot: jsonb("pickup_snapshot"),
  consignee: jsonb("consignee").notNull(), // name, mobile, address, pincode, city, state
  products: jsonb("products").notNull().default([]),
  invoiceNumber: text("invoice_number"),
  ewayBill: text("eway_bill"),
  buyerGstin: text("buyer_gstin"),
  /** Create Order extras: referenceId, orderDate, altMobile, billing, shippingChargesPaise, packageType, rovType, invoice totals. */
  meta: jsonb("meta").notNull().default({}),
  /** Hidden from active Orders tabs (Archive tab). Never deletes anything. */
  archivedAt: ts("archived_at"),
  createdAt: created(),
}, (t) => [
  uniqueIndex("orders_org_number").on(t.orgId, t.orderNumber),
  uniqueIndex("orders_store_ext").on(t.orgId, t.externalStoreId, t.externalOrderId),
  index("orders_org_created").on(t.orgId, t.createdAt),
]);

export const packages = pgTable("packages", {
  id: id(),
  orderId: text("order_id").notNull().references(() => orders.id),
  count: integer("count").notNull(),
  lengthMm: integer("length_mm").notNull(),
  breadthMm: integer("breadth_mm").notNull(),
  heightMm: integer("height_mm").notNull(),
  actualWeightGrams: integer("actual_weight_grams").notNull(), // per box
});

export const shipments = pgTable("shipments", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  orderId: text("order_id").notNull().references(() => orders.id),
  providerAccountId: text("provider_account_id").notNull(),
  provider: text("provider").notNull(),
  carrierCode: text("carrier_code").notNull(),
  carrierName: text("carrier_name").notNull(),
  serviceName: text("service_name").notNull(),
  providerOrderRef: text("provider_order_ref"),
  awb: text("awb"), // only ever set from a provider response
  /** Unguessable reference for public/branded tracking links (never the AWB). */
  publicRef: text("public_ref").unique(),
  lrNumber: text("lr_number"),
  pieceIds: jsonb("piece_ids"),
  bookingStatus: text("booking_status").notNull(), // pending | confirmed | failed | ambiguous | cancelled
  pickupStatus: text("pickup_status").notNull().default("not_scheduled"),
  labelStatus: text("label_status").notNull().default("not_generated"),
  status: text("status").notNull().default("booked"), // normalized tracking status
  quoteId: text("quote_id").notNull(),
  sellPaise: paise("sell_paise").notNull(),
  costPaise: paise("cost_paise").notNull(),
  /** Carrier-confirmed pre-tax charge (when the carrier reports it) and the check against the quoted cost: ok / higher / resolved. */
  carrierChargePaise: paise("carrier_charge_paise"),
  chargeCheck: text("charge_check"),
  reservationId: text("reservation_id"),
  /** sender (Prepaid/COD) | receiver (FOD: freight collected from the receiver at delivery) */
  freightPayer: text("freight_payer").notNull().default("sender"),
  /** FOD: freight the courier collects from the receiver (paise), as shown before booking. */
  receiverFreightPaise: paise("receiver_freight_paise").notNull().default(0),
  fodStatus: text("fod_status"), // pending_collection | collected | settled | disputed
  pickupRef: text("pickup_ref"),
  pickupRequestId: text("pickup_request_id"),
  pickupAgentName: text("pickup_agent_name"),
  pickupAgentPhone: text("pickup_agent_phone"),
  pickupDate: ts("pickup_date"),
  chargeableWeightGrams: integer("chargeable_weight_grams").notNull(),
  carrierWeightGrams: integer("carrier_weight_grams"),
  etaDate: ts("eta_date"),
  lastEventAt: ts("last_event_at"),
  /** Latest carrier scan location (separate from the delivery address). */
  lastLocation: text("last_location"),
  deliveredAt: ts("delivered_at"),
  /** Tracking sync health: last successful pull/push, last error, consecutive failures. */
  lastSyncAt: ts("last_sync_at"),
  lastSyncError: text("last_sync_error"),
  syncFailures: integer("sync_failures").notNull().default(0),
  createdAt: created(),
}, (t) => [
  uniqueIndex("shipments_awb").on(t.provider, t.awb),
  index("shipments_provider_ref").on(t.providerOrderRef),
  index("shipments_lr").on(t.lrNumber),
  index("shipments_org_status").on(t.orgId, t.status),
]);

/** Courier pickup request (PR): one per pickup address + date + courier account; covers one or more shipments. */
export const pickupRequests = pgTable("pickup_requests", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  providerAccountId: text("provider_account_id").notNull(),
  pickupDate: text("pickup_date").notNull(), // YYYY-MM-DD (IST)
  providerRef: text("provider_ref"), // the courier's PR / pickup ID
  status: text("status").notNull(), // requested | auto | failed | cancelled
  shipmentIds: jsonb("shipment_ids").notNull().default([]),
  packageCount: integer("package_count").notNull().default(0),
  agentName: text("agent_name"),
  agentPhone: text("agent_phone"),
  lastError: text("last_error"),
  createdBy: text("created_by"),
  createdAt: created(),
}, (t) => [index("pickup_requests_org").on(t.orgId, t.pickupDate)]);

export const shipmentEvents = pgTable("shipment_events", {
  id: id(),
  shipmentId: text("shipment_id").notNull().references(() => shipments.id),
  dedupeKey: text("dedupe_key").notNull(),
  status: text("status").notNull(),
  rawStatus: text("raw_status"),
  location: text("location"),
  occurredAt: ts("occurred_at").notNull(),
  source: text("source").notNull(), // webhook | poll | manual
  remark: text("remark"),
  createdAt: created(),
}, (t) => [uniqueIndex("shipment_events_dedupe").on(t.dedupeKey)]);

/** Destination changes confirmed by the carrier (never inferred from scan locations). */
export const destinationAmendments = pgTable("destination_amendments", {
  id: id(),
  orderId: text("order_id").notNull().references(() => orders.id),
  shipmentId: text("shipment_id").notNull(),
  previous: jsonb("previous").notNull(),
  next: jsonb("next").notNull(),
  source: text("source").notNull(), // webhook | poll
  dedupeKey: text("dedupe_key").notNull().unique(),
  occurredAt: ts("occurred_at").notNull(),
  createdAt: created(),
});

export const ndrCases = pgTable("ndr_cases", {
  id: id(),
  orgId: text("org_id").notNull(),
  shipmentId: text("shipment_id").notNull().references(() => shipments.id),
  kind: text("kind").notNull(), // ndr | rto
  reason: text("reason"),
  attempt: integer("attempt").notNull().default(1),
  deadlineAt: ts("deadline_at"),
  status: text("status").notNull().default("open"), // open | action_requested | acknowledged | closed
  requestedAction: text("requested_action"), // reattempt | update_address | rto
  requestPayload: jsonb("request_payload"),
  createdAt: created(),
});

export const weightDisputes = pgTable("weight_disputes", {
  id: id(),
  orgId: text("org_id").notNull(),
  shipmentId: text("shipment_id").notNull().references(() => shipments.id),
  declaredGrams: integer("declared_grams").notNull(),
  carrierGrams: integer("carrier_grams").notNull(),
  revisedChargeableGrams: integer("revised_chargeable_grams").notNull(),
  chargePaise: paise("charge_paise").notNull(),
  evidence: jsonb("evidence").notNull().default([]),
  deadlineAt: ts("deadline_at").notNull(),
  status: text("status").notNull().default("open"), // open | disputed | accepted | waived | charged
  resolution: text("resolution"),
  /** csv (courier report import) | api (courier tracking reply) | manual | seed */
  source: text("source").notNull().default("manual"),
  /** Chargeable weight the client was billed for at booking. */
  bookedChargeableGrams: integer("booked_chargeable_grams"),
  /** Extra pre-tax amount the courier billed Vishwaship, when the courier report states it. */
  courierExtraPaise: paise("courier_extra_paise"),
  /** Calculation breakdown (before / after cost, client price, GST, markup) shown to the client and Admin. */
  calc: jsonb("calc"),
  chargedAt: ts("charged_at"),
  createdAt: created(),
}, (t) => [index("weight_disputes_shipment").on(t.shipmentId), index("weight_disputes_status_deadline").on(t.status, t.deadlineAt)]);

// ---------- wallet ----------
export const wallets = pgTable("wallets", {
  id: id(),
  orgId: text("org_id").notNull().unique().references(() => orgs.id),
  postedPaise: paise("posted_paise").notNull().default(0),
  reservedPaise: paise("reserved_paise").notNull().default(0),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: id(),
  walletId: text("wallet_id").notNull().references(() => wallets.id),
  kind: text("kind").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  holdDeltaPaise: paise("hold_delta_paise").notNull().default(0),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  reservationId: text("reservation_id"),
  refType: text("ref_type"),
  refId: text("ref_id"),
  balanceAfterPaise: paise("balance_after_paise").notNull(),
  reservedAfterPaise: paise("reserved_after_paise").notNull(),
  memo: text("memo"),
  createdAt: created(),
}, (t) => [index("ledger_wallet_created").on(t.walletId, t.createdAt)]);

export const reservations = pgTable("reservations", {
  id: id(),
  walletId: text("wallet_id").notNull().references(() => wallets.id),
  amountPaise: paise("amount_paise").notNull(),
  status: text("status").notNull(), // open | settled | released
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
});

export const recharges = pgTable("recharges", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  /** Wallet amount to credit (the requested recharge). */
  amountPaise: paise("amount_paise").notNull(),
  currency: text("currency").notNull().default("INR"),
  /** razorpay | cashfree | manual | demo */
  method: text("method").notNull().default("razorpay"),
  /** Customer-facing reference, e.g. RR100023. */
  requestNumber: text("request_number").unique(),
  razorpayOrderId: text("razorpay_order_id").unique(),
  razorpayPaymentId: text("razorpay_payment_id").unique(),
  /** Gateway order / payment ids for non-Razorpay gateways (Cashfree order_id / cf_payment_id). */
  providerOrderId: text("provider_order_id"),
  providerPaymentId: text("provider_payment_id"),
  // payment_pending | pending_verification | info_required | credited | rejected | failed | expired | cancelled | mismatch
  // (older rows: pending → payment_pending, captured → credited)
  status: text("status").notNull().default("payment_pending"),
  /** Manual UPI: discount and payable fixed at request time (later setting changes never alter it). */
  discountBps: integer("discount_bps").notNull().default(0),
  discountPaise: paise("discount_paise").notNull().default(0),
  payablePaise: paise("payable_paise"),
  /** Customer-reported (manual) or gateway-confirmed amount received. */
  paidPaise: paise("paid_paise"),
  utr: text("utr"),
  utrDuplicate: boolean("utr_duplicate").notNull().default(false),
  paidAt: ts("paid_at"),
  proofKey: text("proof_key"),
  proofName: text("proof_name"),
  proofMime: text("proof_mime"),
  remarks: text("remarks"),
  ticketId: text("ticket_id"),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
  decisionNote: text("decision_note"),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [
  uniqueIndex("recharges_provider_order").on(t.method, t.providerOrderId),
  // one UTR can back only one credited manual recharge
  uniqueIndex("recharges_utr_credited").on(t.utr).where(sql`${t.status} = credited and ${t.method} = manual`),
  index("recharges_org_created").on(t.orgId, t.createdAt),
  index("recharges_status").on(t.status),
]);

/** Approval / payment history of a recharge (shown to Admin; customer-facing notes also go to the ticket). */
export const rechargeEvents = pgTable("recharge_events", {
  id: id(),
  rechargeId: text("recharge_id").notNull().references(() => recharges.id),
  action: text("action").notNull(), // created | submitted | info_requested | info_provided | approved | rejected | gateway_success | gateway_failed | flagged_duplicate_utr
  actorKind: text("actor_kind").notNull(), // customer | staff | system | gateway
  actorUserId: text("actor_user_id"),
  note: text("note"),
  createdAt: created(),
}, (t) => [index("recharge_events_rc").on(t.rechargeId, t.createdAt)]);

/** Admin notification bell (all staff; seen-state per user in users.prefs.staffAlertsSeenAt). */
export const staffAlerts = pgTable("staff_alerts", {
  id: id(),
  kind: text("kind").notNull(), // manual_recharge | recharge_info | ...
  title: text("title").notNull(),
  href: text("href"),
  perm: text("perm"), // permission needed to see it
  createdAt: created(),
}, (t) => [index("staff_alerts_created").on(t.createdAt)]);

// ---------- notifications & credits ----------
export const creditBalances = pgTable("credit_balances", {
  orgId: text("org_id").primaryKey().references(() => orgs.id),
  credits: integer("credits").notNull().default(0),
  held: integer("held").notNull().default(0),
});

export const creditEntries = pgTable("credit_entries", {
  id: id(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(), // purchase | hold | settle | release | waiver | adjustment
  credits: integer("credits").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  pricePaise: paise("price_paise"),
  gstPaise: paise("gst_paise"),
  createdAt: created(),
});

export const creditPacks = pgTable("credit_packs", {
  id: id(),
  credits: integer("credits").notNull(),
  unitPricePaise: integer("unit_price_paise").notNull(), // e.g. 25 = ₹0.25
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
});

export const notificationSettings = pgTable("notification_settings", {
  id: id(),
  orgId: text("org_id"), // null = admin default
  channel: text("channel").notNull(), // email | sms | whatsapp | webhook
  event: text("event").notNull(), // "*" = master switch
  enabled: boolean("enabled").notNull(),
  templateId: text("template_id"),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [uniqueIndex("notif_org_chan_evt").on(t.orgId, t.channel, t.event)]);

export const notificationTemplates = pgTable("notification_templates", {
  id: id(),
  channel: text("channel").notNull(),
  event: text("event").notNull(),
  language: text("language").notNull().default("en"),
  body: text("body").notNull(),
  providerTemplateName: text("provider_template_name"),
  approvalState: text("approval_state").notNull().default("draft"), // draft | submitted | approved | rejected
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
});

export const notificationDeliveries = pgTable("notification_deliveries", {
  id: id(),
  orgId: text("org_id").notNull(),
  channel: text("channel").notNull(),
  event: text("event").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(), // event id + channel + recipient
  recipientMasked: text("recipient_masked").notNull(),
  providerAccountId: text("provider_account_id"),
  providerMessageId: text("provider_message_id"),
  status: text("status").notNull(), // queued | sent | delivered | read | failed | skipped_no_credit
  creditsCharged: integer("credits_charged").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: created(),
});

export const codConfirmations = pgTable("cod_confirmations", {
  id: id(),
  orgId: text("org_id").notNull(),
  orderId: text("order_id").notNull().unique().references(() => orders.id),
  status: text("status").notNull(),
  // pending | confirmed | rejected | no_response | needs_review | send_failed | expired
  sentAt: ts("sent_at"),
  buyerResponse: text("buyer_response"), // confirm | cancel
  cancellationStatus: text("cancellation_status"), // requested | cancelled | failed | action_required
  cancellationReason: text("cancellation_reason"),
  cancellationAt: ts("cancellation_at"),
  reminderAt: ts("reminder_at"),
  expiresAt: ts("expires_at"),
  decidedAt: ts("decided_at"),
  replyMessageId: text("reply_message_id"),
  createdAt: created(),
});

// ---------- support ----------
export const tickets = pgTable("tickets", {
  id: id(),
  orgId: text("org_id").notNull(),
  number: text("number").notNull().unique(),
  category: text("category").notNull(),
  subject: text("subject").notNull(),
  shipmentId: text("shipment_id"),
  awb: text("awb"),
  orderId: text("order_id"),
  orderNumber: text("order_number"),
  status: text("status").notNull().default("open"),
  /** Client submission key: a retried / double-clicked "Save" returns the same ticket. */
  idemKey: text("idem_key"),
  createdAt: created(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("tickets_org_idem").on(t.orgId, t.idemKey), index("tickets_org_status").on(t.orgId, t.status)]);

export const ticketMessages = pgTable("ticket_messages", {
  id: id(),
  ticketId: text("ticket_id").notNull().references(() => tickets.id),
  authorUserId: text("author_user_id").notNull(),
  authorKind: text("author_kind").notNull(),
  body: text("body").notNull(),
  attachments: jsonb("attachments").notNull().default([]),
  /** Client message key: a retried send never creates a second message. */
  clientId: text("client_id"),
  createdAt: created(),
}, (t) => [uniqueIndex("ticket_messages_client").on(t.ticketId, t.clientId)]);

export const inAppAlerts = pgTable("in_app_alerts", {
  id: id(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  href: text("href"),
  readAt: ts("read_at"),
  /** Set once the Android push for this alert was dispatched (or skipped): each alert is pushed at most once. */
  pushedAt: ts("pushed_at"),
  createdAt: created(),
});

// ---------- store integrations ----------
export const storeConnections = pgTable("store_connections", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  platform: text("platform").notNull(), // shopify | woocommerce
  storeUrl: text("store_url").notNull(), // https://shop.myshopify.com or https://store.example.com
  credentialsEnc: text("credentials_enc").notNull(), // write-only
  credentialsHint: text("credentials_hint"),
  status: text("status").notNull().default("connected"), // connected | error | disconnected
  warehouseId: text("warehouse_id").references(() => warehouses.id),
  defaultPackage: jsonb("default_package").notNull().default({ lengthCm: 20, breadthCm: 15, heightCm: 10, weightKg: 0.5 }),
  autoSync: boolean("auto_sync").notNull().default(false),
  pushTracking: boolean("push_tracking").notNull().default(true),
  lastSyncAt: ts("last_sync_at"),
  lastError: text("last_error"),
  createdAt: created(),
}, (t) => [uniqueIndex("store_conn_org_url").on(t.orgId, t.storeUrl)]);

export const storeImportLog = pgTable("store_import_log", {
  id: id(),
  connectionId: text("connection_id").notNull().references(() => storeConnections.id),
  runId: text("run_id").notNull(),
  externalOrderId: text("external_order_id").notNull(),
  externalOrderName: text("external_order_name"),
  outcome: text("outcome").notNull(), // imported | duplicate | error | skipped
  message: text("message"),
  orderId: text("order_id"),
  createdAt: created(),
}, (t) => [index("store_import_conn").on(t.connectionId, t.createdAt)]);

// ---------- developer API & webhooks ----------
export const apiKeys = pgTable("api_keys", {
  id: id(), // public key id, e.g. vsk_live_xxx
  orgId: text("org_id"), // null for admin service accounts
  label: text("label").notNull(),
  secretHash: text("secret_hash").notNull(),
  scopes: jsonb("scopes").notNull(),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
  lastUsedAt: ts("last_used_at"),
  createdBy: text("created_by").notNull(),
  createdAt: created(),
});

export const idempotencyRecords = pgTable("idempotency_records", {
  key: text("key").primaryKey(), // org + api key + Idempotency-Key header
  requestHash: text("request_hash").notNull(),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
  createdAt: created(),
});

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: id(),
  orgId: text("org_id").notNull(),
  url: text("url").notNull(),
  secretEnc: text("secret_enc").notNull(),
  events: jsonb("events").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: created(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: id(),
  endpointId: text("endpoint_id").notNull().references(() => webhookEndpoints.id),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull(), // pending | delivered | failed | dead
  attempts: integer("attempts").notNull().default(0),
  lastStatusCode: integer("last_status_code"),
  nextAttemptAt: ts("next_attempt_at"),
  createdAt: created(),
}, (t) => [uniqueIndex("wh_deliv_ep_evt").on(t.endpointId, t.eventId)]);

export const inboundEvents = pgTable("inbound_events", {
  id: id(),
  provider: text("provider").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  verified: boolean("verified").notNull(),
  payloadRedacted: jsonb("payload_redacted").notNull(),
  processedAt: ts("processed_at"),
  error: text("error"),
  createdAt: created(),
});

export const jobs = pgTable("jobs", {
  id: id(),
  queue: text("queue").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("queued"), // queued | running | done | failed | dead
  attempts: integer("attempts").notNull().default(0),
  runAt: ts("run_at").notNull().default(sql`now()`),
  lastError: text("last_error"),
  dedupeKey: text("dedupe_key").unique(),
  createdAt: created(),
});

// ---------- subscriptions & feature access ----------
export const plans = pgTable("plans", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  pricePaise: paise("price_paise").notNull().default(0),
  billingPeriodDays: integer("billing_period_days").notNull().default(30),
  modules: jsonb("modules").notNull().default([]), // module keys included
  events: jsonb("events").notNull().default([]), // notification events included (e.g. whatsapp:out_for_delivery)
  active: boolean("active").notNull().default(true),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
  createdAt: created(),
});

export const orgSubscriptions = pgTable("org_subscriptions", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  planId: text("plan_id").notNull().references(() => plans.id),
  status: text("status").notNull().default("active"), // active | cancelled
  startsAt: ts("starts_at").notNull().default(sql`now()`),
  expiresAt: ts("expires_at"),
  createdBy: text("created_by"),
  createdAt: created(),
}, (t) => [index("org_sub_org").on(t.orgId)]);

/** scope=global (orgId null) or scope=org. An org override beats the plan; global default beats module default. */
export const featureOverrides = pgTable("feature_overrides", {
  id: id(),
  orgId: text("org_id"),
  module: text("module").notNull(),
  enabled: boolean("enabled").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [uniqueIndex("feature_override_scope").on(t.orgId, t.module)]);

// ---------- editable customer-facing content ----------
export const contentBlocks = pgTable("content_blocks", {
  key: text("key").notNull(),
  locale: text("locale").notNull().default("en"),
  draft: text("draft"),
  published: text("published"),
  updatedBy: text("updated_by"),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
  publishedBy: text("published_by"),
  publishedAt: ts("published_at"),
}, (t) => [uniqueIndex("content_key_locale").on(t.key, t.locale)]);

// ---------- branded tracking page ----------
export const trackingPages = pgTable("tracking_pages", {
  orgId: text("org_id").primaryKey().references(() => orgs.id),
  slug: text("slug").notNull().unique(),
  draft: jsonb("draft").notNull().default({}),
  published: jsonb("published"),
  isPublished: boolean("is_published").notNull().default(false),
  publishedAt: ts("published_at"),
  disabledByAdmin: boolean("disabled_by_admin").notNull().default(false),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
});

// ---------- WhatsApp message log ----------
export const whatsappMessages = pgTable("whatsapp_messages", {
  id: id(),
  orgId: text("org_id").notNull(),
  orderId: text("order_id"),
  shipmentId: text("shipment_id"),
  event: text("event").notNull(), // out_for_delivery | cod_confirmation
  templateName: text("template_name"),
  recipientMasked: text("recipient_masked").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  providerMessageId: text("provider_message_id"),
  status: text("status").notNull(), // queued | sent | delivered | read | failed | skipped
  buyerResponse: text("buyer_response"),
  respondedAt: ts("responded_at"),
  error: text("error"),
  creditsCharged: integer("credits_charged").notNull().default(0),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [index("wa_org_created").on(t.orgId, t.createdAt), index("wa_provider_msg").on(t.providerMessageId)]);

// ---------- Others: buyers, products, packaging, tags ----------
export const buyers = pgTable("buyers", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  mobile: text("mobile").notNull(), // 10 digits
  email: text("email"),
  addresses: jsonb("addresses").notNull().default([]), // [{label,line1,line2,pincode,city,state}]
  notes: text("notes"),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [uniqueIndex("buyers_org_mobile").on(t.orgId, t.mobile)]);

export const products = pgTable("products", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
  unitPricePaise: paise("unit_price_paise").notNull().default(0), // declared value per unit
  hsn: text("hsn"),
  weightGrams: integer("weight_grams").notNull().default(0),
  lengthMm: integer("length_mm").notNull().default(0),
  breadthMm: integer("breadth_mm").notNull().default(0),
  heightMm: integer("height_mm").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [uniqueIndex("products_org_sku").on(t.orgId, t.sku)]);

export const packagingPresets = pgTable("packaging_presets", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  lengthMm: integer("length_mm").notNull(),
  breadthMm: integer("breadth_mm").notNull(),
  heightMm: integer("height_mm").notNull(),
  tareGrams: integer("tare_grams").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: created(),
}, (t) => [uniqueIndex("packaging_org_name").on(t.orgId, t.name)]);

export const orderTags = pgTable("order_tags", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  color: text("color").notNull().default("#0b1f3a"),
  createdAt: created(),
}, (t) => [uniqueIndex("order_tags_org_name").on(t.orgId, t.name)]);

export const orderTagLinks = pgTable("order_tag_links", {
  orderId: text("order_id").notNull().references(() => orders.id),
  tagId: text("tag_id").notNull().references(() => orderTags.id),
}, (t) => [primaryKey({ columns: [t.orderId, t.tagId] })]);

// ---------- per-account settings (label, invoice, courier prefs, EDD widget, OMS) ----------
export const orgSettings = pgTable("org_settings", {
  orgId: text("org_id").notNull().references(() => orgs.id),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [primaryKey({ columns: [t.orgId, t.key] })]);

export const assignRules = pgTable("assign_rules", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  priority: integer("priority").notNull().default(100), // lower runs first
  active: boolean("active").notNull().default(true),
  conditions: jsonb("conditions").notNull().default({}), // {mode,payment,warehouseId,pinPrefixes[],minGrams,maxGrams}
  couriers: jsonb("couriers").notNull().default([]), // carrier codes in preference order
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [index("assign_rules_org").on(t.orgId, t.priority)]);

// ---------- report download centre ----------
export const reportExports = pgTable("report_exports", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  userId: text("user_id"),
  reportKey: text("report_key").notNull(),
  filters: jsonb("filters").notNull().default({}),
  format: text("format").notNull(), // csv | xlsx
  status: text("status").notNull().default("queued"), // queued | running | ready | failed
  rowCount: integer("row_count"),
  fileB64: text("file_b64"), // small exports kept inline; expires after 7 days
  error: text("error"),
  createdAt: created(),
  finishedAt: ts("finished_at"),
  expiresAt: ts("expires_at"),
}, (t) => [index("report_exports_org").on(t.orgId, t.createdAt)]);

// ---------- COD remittance batches ----------
export const codRemittances = pgTable("cod_remittances", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  reference: text("reference"), // bank UTR / payout reference once paid
  cycleDate: ts("cycle_date").notNull(),
  expectedPayoutAt: ts("expected_payout_at").notNull(),
  grossPaise: paise("gross_paise").notNull(),
  deductionsPaise: paise("deductions_paise").notNull().default(0), // early-COD fee, adjustments
  netPaise: paise("net_paise").notNull(),
  deductionNote: text("deduction_note"),
  status: text("status").notNull().default("scheduled"), // scheduled | paid | cancelled
  earlyCod: boolean("early_cod").notNull().default(false),
  paidAt: ts("paid_at"),
  createdBy: text("created_by"),
  createdAt: created(),
}, (t) => [index("cod_remit_org").on(t.orgId, t.cycleDate)]);

export const codRemittanceItems = pgTable("cod_remittance_items", {
  remittanceId: text("remittance_id").notNull().references(() => codRemittances.id),
  shipmentId: text("shipment_id").notNull().unique().references(() => shipments.id), // a shipment is remitted once
  codPaise: paise("cod_paise").notNull(),
}, (t) => [primaryKey({ columns: [t.remittanceId, t.shipmentId] })]);

// ---------- Vishwaship billing documents (tax invoices, credit / debit notes) ----------
export const billingDocuments = pgTable("billing_documents", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  kind: text("kind").notNull(), // invoice | credit_note | debit_note
  number: text("number").notNull().unique(),
  docDate: ts("doc_date").notNull(),
  periodFrom: ts("period_from"),
  periodTo: ts("period_to"),
  taxablePaise: paise("taxable_paise").notNull(),
  gstPaise: paise("gst_paise").notNull(),
  totalPaise: paise("total_paise").notNull(),
  reason: text("reason"),
  refType: text("ref_type"), // shipment | invoice | dispute
  refId: text("ref_id"),
  lines: jsonb("lines").notNull().default([]), // [{description, ref, taxablePaise, gstPaise}]
  createdBy: text("created_by"),
  createdAt: created(),
}, (t) => [index("billing_docs_org").on(t.orgId, t.kind, t.docDate)]);

// ---------- Early COD (faster remittance) — separate from WhatsApp COD Confirmation ----------
export const earlyCodSubscriptions = pgTable("early_cod_subscriptions", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  status: text("status").notNull(), // active | cancelled
  feeBps: integer("fee_bps").notNull(), // snapshot of terms at subscription time
  cycleDays: integer("cycle_days").notNull(), // payout D+N after delivery
  termsVersion: integer("terms_version").notNull(),
  startedAt: ts("started_at").notNull().default(sql`now()`),
  cancelledAt: ts("cancelled_at"),
  createdAt: created(),
}, (t) => [index("early_cod_org").on(t.orgId)]);

// ---------- public website media (logos, team photos, hero video/poster, page images) ----------
// Stored in the database so uploads survive redeploys on hosts that replace the disk. Public by design.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
export const siteAssets = pgTable("site_assets", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // image | video
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  name: text("name"),
  data: bytea("data").notNull(),
  createdBy: text("created_by"),
  createdAt: created(),
});

// ---------- pickup manifests ----------
/**
 * A generated pickup handover manifest. The AWB list (groups) and the PDF are frozen at generation, so a re-download
 * is always the original even after shipment statuses change. A new generation always gets a new Manifest ID.
 */
export const manifests = pgTable("manifests", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  manifestNo: text("manifest_no").notNull().unique(),
  scope: text("scope").notNull(), // daily | shipment
  bookingDate: text("booking_date").notNull(), // YYYY-MM-DD (IST)
  filters: jsonb("filters").notNull().default({}),
  groups: jsonb("groups").notNull().default([]), // [{ carrier, pickup, rows: [{ shipmentId, awb, orderNumber, receiver, city, pincode, boxes }] }]
  awbCount: integer("awb_count").notNull(),
  boxCount: integer("box_count").notNull(),
  pdfKey: text("pdf_key").notNull(),
  signedCopy: jsonb("signed_copy"), // { key, name, mime, size, uploadedAt }
  createdBy: text("created_by"),
  createdAt: created(),
}, (t) => [index("manifests_org_created").on(t.orgId, t.createdAt)]);

// ---------- transactional email (Admin → Settings → Email) ----------
export const emailSenders = pgTable("email_senders", {
  id: id(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  replyTo: text("reply_to"),
  isDefault: boolean("is_default").notNull().default(false),
  /** pending | verified | failed (provider domain verification) · disabled */
  status: text("status").notNull().default("pending"),
  statusDetail: text("status_detail"),
  checkedAt: ts("checked_at"),
  createdAt: created(),
});
export const emailTemplates = pgTable("email_templates", {
  event: text("event").primaryKey(),
  subject: text("subject").notNull(),
  body: text("body").notNull(), // plain text with {{placeholders}}; wrapped in the branded layout when sent
  updatedBy: text("updated_by"),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
});
export const emailRules = pgTable("email_rules", {
  event: text("event").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  senderId: text("sender_id"), // null = default sender
  toClient: boolean("to_client").notNull().default(true),
  toRecipient: boolean("to_recipient").notNull().default(false),
  updatedBy: text("updated_by"),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
});
export const emailLogs = pgTable("email_logs", {
  id: id(),
  event: text("event").notNull(),
  dedupeKey: text("dedupe_key").unique(), // event + subject + address: a repeated courier update never sends twice
  orgId: text("org_id"),
  shipmentId: text("shipment_id"),
  toEmail: text("to_email").notNull(),
  toKind: text("to_kind").notNull(), // client | recipient | signup | test
  senderEmail: text("sender_email").notNull(),
  subject: text("subject").notNull(),
  /** Placeholder values with secrets (OTP) masked — used for retry and shown to Admin. */
  vars: jsonb("vars").notNull().default({}),
  status: text("status").notNull().default("queued"), // queued | sent | failed | skipped
  error: text("error"),
  providerId: text("provider_id"),
  attempts: integer("attempts").notNull().default(0),
  retryable: boolean("retryable").notNull().default(true),
  sentAt: ts("sent_at"),
  createdAt: created(),
}, (t) => [index("email_logs_created").on(t.createdAt)]);

// ---------- Android app ----------
/** One row per signed-in app install. Push token is cleared on logout so alerts never reach a device after sign-out. */
export const mobileDevices = pgTable("mobile_devices", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id),
  orgId: text("org_id").notNull(),
  /** sha256 of the session token this device signed in with (sessions.id). */
  sessionId: text("session_id").notNull(),
  installId: text("install_id").notNull(), // random per install, generated on the device
  platform: text("platform").notNull().default("android"),
  appVersion: text("app_version"),
  pushToken: text("push_token"), // FCM registration token; null when push is off or after logout
  pushEnabled: boolean("push_enabled").notNull().default(false),
  lastSeenAt: ts("last_seen_at").notNull().default(sql`now()`),
  revokedAt: ts("revoked_at"),
  createdAt: created(),
}, (t) => [uniqueIndex("mobile_devices_install").on(t.installId), index("mobile_devices_org").on(t.orgId)]);

/** In-app / web "Delete my account" requests (Google Play account-deletion requirement). Staff process them in Admin. */
export const accountDeletionRequests = pgTable("account_deletion_requests", {
  id: id(),
  userId: text("user_id").references(() => users.id),
  orgId: text("org_id"),
  email: text("email").notNull(),
  reason: text("reason"),
  source: text("source").notNull(), // app | web
  status: text("status").notNull().default("requested"), // requested | processing | completed | rejected
  note: text("note"),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
  createdAt: created(),
}, (t) => [index("account_deletion_status").on(t.status)]);

// ---------- online store (merchant storefronts) ----------
/**
 * One storefront per org (Phase 1). Theme config lives in `draftTheme`; `publishedTheme` is what buyers see.
 * Every published version is kept in store_theme_versions so the merchant can restore it.
 */
export const stores = pgTable("stores", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  status: text("status").notNull().default("draft"), // draft | live | paused | suspended
  /** Onboarding: highest step reached (1-7) and the steps marked done. */
  onboardingStep: integer("onboarding_step").notNull().default(1),
  stepsDone: jsonb("steps_done").notNull().default([]),
  themeKey: text("theme_key").notNull().default("bazaar"),
  draftTheme: jsonb("draft_theme").notNull().default({}),
  publishedTheme: jsonb("published_theme"),
  /** Contact, about, policies, SEO defaults, checkout basics (COD, shipping fee). */
  settings: jsonb("settings").notNull().default({}),
  /** Admin applied a custom design: merchant theme switching is locked to it. */
  customDesign: boolean("custom_design").notNull().default(false),
  suspendedReason: text("suspended_reason"),
  /** Billing (Phase 4): free trial end, paid-until date of the current plan, and the Vishwaship staff member looking after the store. */
  trialEndsAt: ts("trial_ends_at"),
  paidUntil: ts("paid_until"),
  planId: text("plan_id"),
  assignedStaffId: text("assigned_staff_id"),
  publishedAt: ts("published_at"),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [uniqueIndex("stores_slug").on(t.slug), uniqueIndex("stores_org").on(t.orgId), index("stores_status").on(t.status)]);

export const storeThemeVersions = pgTable("store_theme_versions", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  version: integer("version").notNull(),
  themeKey: text("theme_key").notNull(),
  config: jsonb("config").notNull(),
  publishedBy: text("published_by"),
  note: text("note"),
  createdAt: created(),
}, (t) => [uniqueIndex("store_theme_versions_v").on(t.storeId, t.version)]);

export const storeDomains = pgTable("store_domains", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  hostname: text("hostname").notNull(),
  verifyToken: text("verify_token").notNull(),
  status: text("status").notNull().default("pending_dns"), // pending_dns | verified | failed
  sslStatus: text("ssl_status").notNull().default("pending_setup"), // pending_setup | pending | active | failed
  isPrimary: boolean("is_primary").notNull().default(false),
  lastCheckedAt: ts("last_checked_at"),
  lastCheckMessage: text("last_check_message"),
  verifiedAt: ts("verified_at"),
  createdAt: created(),
}, (t) => [uniqueIndex("store_domains_host").on(t.hostname), index("store_domains_store").on(t.storeId)]);

export const storeCategories = pgTable("store_categories", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  sort: integer("sort").notNull().default(0),
  createdAt: created(),
}, (t) => [uniqueIndex("store_categories_slug").on(t.storeId, t.slug)]);

export const storeProducts = pgTable("store_products", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  pricePaise: paise("price_paise").notNull(),
  comparePaise: paise("compare_paise"),
  categoryId: text("category_id").references(() => storeCategories.id),
  /** Ordered list of store_media ids. */
  images: jsonb("images").notNull().default([]),
  stock: integer("stock").notNull().default(0),
  weightGrams: integer("weight_grams").notNull().default(500),
  status: text("status").notNull().default("active"), // draft | active | archived
  featured: boolean("featured").notNull().default(false),
  seo: jsonb("seo").notNull().default({}),
  sku: text("sku"),
  hsn: text("hsn"),
  /** GST rate in basis points (prices are tax-inclusive; used for invoices). */
  taxBps: integer("tax_bps").notNull().default(0),
  lowStockAt: integer("low_stock_at").notNull().default(5),
  lengthMm: integer("length_mm").notNull().default(0),
  breadthMm: integer("breadth_mm").notNull().default(0),
  heightMm: integer("height_mm").notNull().default(0),
  /** Option names when the product has variants, e.g. ["Size","Colour"]. Empty = no variants (stock on the product). */
  options: jsonb("options").notNull().default([]),
  /** Units held for orders that have not left the warehouse yet (`stock` is what can still be sold). */
  reserved: integer("reserved").notNull().default(0),
  /** Units set aside as damaged (not sellable). */
  damaged: integer("damaged").notNull().default(0),
  /** Purchase cost per unit (for profit). Null = not entered yet. */
  unitCostPaise: paise("unit_cost_paise"),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [uniqueIndex("store_products_slug").on(t.storeId, t.slug), index("store_products_store").on(t.storeId, t.status)]);

/** A sellable variant (e.g. "M / Red") with its own price, stock and weight. */
export const storeProductVariants = pgTable("store_product_variants", {
  id: id(),
  productId: text("product_id").notNull().references(() => storeProducts.id),
  storeId: text("store_id").notNull(),
  orgId: text("org_id").notNull(),
  title: text("title").notNull(),
  optionValues: jsonb("option_values").notNull().default([]),
  sku: text("sku"),
  pricePaise: paise("price_paise").notNull(),
  comparePaise: paise("compare_paise"),
  stock: integer("stock").notNull().default(0),
  weightGrams: integer("weight_grams"),
  sort: integer("sort").notNull().default(0),
  archived: boolean("archived").notNull().default(false),
  reserved: integer("reserved").notNull().default(0),
  damaged: integer("damaged").notNull().default(0),
  /** Null = use the product's unit cost. */
  unitCostPaise: paise("unit_cost_paise"),
  createdAt: created(),
}, (t) => [index("store_variants_product").on(t.productId)]);

export const storeCoupons = pgTable("store_coupons", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  code: text("code").notNull(),
  kind: text("kind").notNull(), // percent | flat | free_shipping
  /** percent: basis points; flat: paise; free_shipping: 0 */
  value: integer("value").notNull().default(0),
  maxDiscountPaise: paise("max_discount_paise"),
  minSubtotalPaise: paise("min_subtotal_paise").notNull().default(0),
  maxUses: integer("max_uses"),
  used: integer("used").notNull().default(0),
  startsAt: ts("starts_at"),
  endsAt: ts("ends_at"),
  active: boolean("active").notNull().default(true),
  /** Show this coupon as an offer on product pages. */
  showOnStore: boolean("show_on_store").notNull().default(false),
  createdAt: created(),
}, (t) => [uniqueIndex("store_coupons_code").on(t.storeId, t.code)]);

/**
 * A buyer's order on a merchant store. Payment state lives here; fulfilment (booking, AWB, pickup, delivery, COD
 * collection and remittance) lives on the linked shipping order (orders.id) and its shipment, so it is never copied.
 * Online payments go to the merchant's own Razorpay account and never touch the Vishwaship wallet.
 */
export const storeOrders = pgTable("store_orders", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  number: text("number").notNull(),
  /** Client-generated key for one checkout attempt: retries return the same order. */
  checkoutKey: text("checkout_key").notNull(),
  /** Random token that lets the buyer open the confirmation page. */
  buyerToken: text("buyer_token").notNull(),
  status: text("status").notNull(), // pending_payment | placed | cancelled
  paymentMethod: text("payment_method").notNull(), // cod | razorpay | cashfree | phonepe | paytm
  paymentStatus: text("payment_status").notNull(), // pending | paid | failed | refund_due | refunded | cod_pending
  buyer: jsonb("buyer").notNull(), // name, mobile, email, line1, line2, pincode, city, state
  lines: jsonb("lines").notNull(), // [{productId, variantId, title, variantTitle, sku, qty, unitPaise, weightGrams, hsn, taxBps}]
  subtotalPaise: paise("subtotal_paise").notNull(),
  discountPaise: paise("discount_paise").notNull().default(0),
  shippingPaise: paise("shipping_paise").notNull().default(0),
  codFeePaise: paise("cod_fee_paise").notNull().default(0),
  totalPaise: paise("total_paise").notNull(),
  couponCode: text("coupon_code"),
  razorpayOrderId: text("razorpay_order_id"),
  razorpayPaymentId: text("razorpay_payment_id"),
  /** Cashfree / PhonePe / Paytm: our order reference at the gateway, its payment id, and the checkout session to resume. */
  pgOrderId: text("pg_order_id"),
  pgPaymentId: text("pg_payment_id"),
  pgSession: jsonb("pg_session"),
  /** Linked shipping order (orders.id) created once the order is placed. */
  shippingOrderId: text("shipping_order_id"),
  stockReleased: boolean("stock_released").notNull().default(false),
  /** reserved (held for this order) | deducted (left the warehouse) | legacy (orders from before reservations). */
  stockState: text("stock_state").notNull().default("reserved"),
  /** Merchant decision on a placed order: pending | accepted | rejected. */
  acceptance: text("acceptance").notNull().default("pending"),
  acceptedAt: ts("accepted_at"),
  acceptedBy: text("accepted_by"),
  rejectReason: text("reject_reason"),
  /** Merchant confirmed the parcel is packed (Packing & Dispatch). */
  packedAt: ts("packed_at"),
  packedBy: text("packed_by"),
  /** Process Orders steps: label printed (Print → Pack) and parcel handed to the courier (Handover). */
  labelPrintedAt: ts("label_printed_at"),
  handedOverAt: ts("handed_over_at"),
  /** Goods that came back (RTO or customer return), counted once: [{index, sellable, damaged, missing}] + who / when. */
  returnInspection: jsonb("return_inspection"),
  returnInspectedAt: ts("return_inspected_at"),
  /** Refund at the gateway: {gateway, refId, gatewayRefundId, amountPaise, status: pending|processed|failed, message, startedAt, updatedAt}. */
  refund: jsonb("refund"),
  /** Unit cost of each line when the goods left the warehouse: [{productId, variantId, qty, unitCostPaise|null}]. */
  costs: jsonb("costs"),
  /** UTM / click ids captured on the storefront (used by marketing attribution). */
  attribution: jsonb("attribution").notNull().default({}),
  note: text("note"),
  paidAt: ts("paid_at"),
  placedAt: ts("placed_at"),
  cancelledAt: ts("cancelled_at"),
  createdAt: created(),
}, (t) => [
  uniqueIndex("store_orders_number").on(t.storeId, t.number),
  uniqueIndex("store_orders_checkout").on(t.storeId, t.checkoutKey),
  uniqueIndex("store_orders_rzp_order").on(t.razorpayOrderId),
  uniqueIndex("store_orders_rzp_payment").on(t.razorpayPaymentId),
  uniqueIndex("store_orders_pg_order").on(t.pgOrderId),
  index("store_orders_store_created").on(t.storeId, t.createdAt),
]);

/** Every stock change on a store product/variant (orders, receipts, corrections, damage, returns). */
export const storeStockMoves = pgTable("store_stock_moves", {
  id: id(),
  storeId: text("store_id").notNull(),
  orgId: text("org_id").notNull(),
  productId: text("product_id").notNull(),
  variantId: text("variant_id"),
  /** order_reserved | order_released | order_dispatched | receipt | adjust | damage | return_sellable | return_damaged | return_missing */
  kind: text("kind").notNull(),
  /** Change in sellable, held and damaged units. */
  available: integer("available").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  damaged: integer("damaged").notNull().default(0),
  unitCostPaise: paise("unit_cost_paise"),
  storeOrderId: text("store_order_id"),
  reason: text("reason"),
  actorUserId: text("actor_user_id"),
  createdAt: created(),
}, (t) => [index("store_stock_moves_product").on(t.productId, t.createdAt), index("store_stock_moves_store").on(t.storeId, t.createdAt)]);

/**
 * Merchant expenses for the store P&L (packaging, rent, salaries, ads …). Amount is what was paid (GST included);
 * gstPaise is the GST inside it. Tagged to an order when it belongs to one, else store-level overhead.
 * A recurring expense is copied once per month by the background job (recurringOf + month is unique). Deleting keeps
 * the row (deletedAt) for the audit trail.
 */
export const storeExpenses = pgTable("store_expenses", {
  id: id(),
  storeId: text("store_id").notNull(),
  orgId: text("org_id").notNull(),
  /** IST calendar date YYYY-MM-DD. */
  spentOn: text("spent_on").notNull(),
  category: text("category").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  gstPaise: paise("gst_paise").notNull().default(0),
  /** GST on this bill can be claimed back (input tax credit). */
  gstRecoverable: boolean("gst_recoverable").notNull().default(false),
  note: text("note"),
  storeOrderId: text("store_order_id"),
  receiptKey: text("receipt_key"),
  receiptMime: text("receipt_mime"),
  recurring: boolean("recurring").notNull().default(false),
  recurringOf: text("recurring_of"),
  /** YYYY-MM of a generated recurring copy. */
  recurringMonth: text("recurring_month"),
  createdBy: text("created_by"),
  deletedAt: ts("deleted_at"),
  createdAt: created(),
}, (t) => [index("store_expenses_store_day").on(t.storeId, t.spentOn), uniqueIndex("store_expenses_recurring").on(t.recurringOf, t.recurringMonth)]);

/**
 * RTO charge of one shipment to the merchant: estimate when it turns RTO (quoted / awaiting), then the final amount
 * from a carrier invoice, settlement file, integration or an audited staff adjustment (confirmed / adjusted), and
 * reconciled once the wallet matches. chargedPaise is what has actually moved through the wallet (rto_charge debits
 * minus rto_credit credits), so a re-confirmation only moves the difference. History keeps every change.
 */
export const rtoCharges = pgTable("rto_charges", {
  id: id(),
  orgId: text("org_id").notNull(),
  shipmentId: text("shipment_id").notNull(),
  state: text("state").notNull().default("awaiting"), // quoted | awaiting | confirmed | adjusted | reconciled
  estimatePaise: paise("estimate_paise").notNull().default(0),
  estimateBasis: text("estimate_basis"),
  /** Merchant-facing final RTO charge incl. GST, and the GST inside it. */
  finalPaise: paise("final_paise"),
  gstPaise: paise("gst_paise"),
  /** Other reverse charges / surcharges inside finalPaise, and credits given back. */
  otherPaise: paise("other_paise").notNull().default(0),
  creditsPaise: paise("credits_paise").notNull().default(0),
  source: text("source"), // carrier_invoice | settlement_file | integration | staff_adjustment
  reference: text("reference"),
  chargedPaise: paise("charged_paise").notNull().default(0),
  history: jsonb("history").notNull().default([]),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [uniqueIndex("rto_charges_shipment").on(t.shipmentId), index("rto_charges_org").on(t.orgId, t.state)]);

/** A merchant's question about the COD money of one shipment (Vishwaship staff resolve it). */
export const codDisputes = pgTable("cod_disputes", {
  id: id(),
  orgId: text("org_id").notNull(),
  shipmentId: text("shipment_id").notNull(),
  note: text("note").notNull(),
  status: text("status").notNull().default("open"), // open | resolved
  resolution: text("resolution"),
  createdBy: text("created_by"),
  resolvedBy: text("resolved_by"),
  createdAt: created(),
  resolvedAt: ts("resolved_at"),
}, (t) => [index("cod_disputes_org").on(t.orgId, t.status), index("cod_disputes_ship").on(t.shipmentId)]);

/** Timeline of a store order (placed, paid, accepted, rejected, refund, dispatched …). */
export const storeOrderEvents = pgTable("store_order_events", {
  id: id(),
  storeOrderId: text("store_order_id").notNull(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  actorUserId: text("actor_user_id"),
  createdAt: created(),
}, (t) => [index("store_order_events_order").on(t.storeOrderId, t.createdAt)]);

/** Store images (logo, banners, product photos). Kept in the database so redeploys never lose them. */
export const storeMedia = pgTable("store_media", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  createdAt: created(),
}, (t) => [index("store_media_store").on(t.storeId)]);

/** Public "Request help" leads from the Create Your Online Store page. */
export const storeHelpRequests = pgTable("store_help_requests", {
  id: id(),
  name: text("name").notNull(),
  mobile: text("mobile").notNull(),
  email: text("email"),
  message: text("message"),
  orgId: text("org_id"),
  status: text("status").notNull().default("new"), // new | contacted | closed
  createdAt: created(),
});

// ---------- online store: marketing (pixels, conversions, ad stats, visits) ----------
/**
 * One server-side conversion per store order and platform (Meta Conversions API, GA4 Measurement Protocol).
 * eventId is shared with the browser pixel so the platform de-duplicates the two.
 */
export const storeConversions = pgTable("store_conversions", {
  id: id(),
  storeOrderId: text("store_order_id").notNull().references(() => storeOrders.id),
  orgId: text("org_id").notNull(),
  platform: text("platform").notNull(), // meta | ga4
  eventId: text("event_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | sent | skipped | failed
  reason: text("reason"),
  attempts: integer("attempts").notNull().default(0),
  sentAt: ts("sent_at"),
  createdAt: created(),
}, (t) => [uniqueIndex("store_conversions_once").on(t.storeOrderId, t.platform)]);

/** Daily ad results per platform/campaign: from the platform API (meta) or a merchant CSV upload (google). */
export const storeAdStats = pgTable("store_ad_stats", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  platform: text("platform").notNull(), // meta | google
  day: text("day").notNull(), // YYYY-MM-DD (IST)
  campaignId: text("campaign_id").notNull().default(""),
  campaignName: text("campaign_name"),
  spendPaise: paise("spend_paise").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  /** What the ad platform says it attributed — shown separately from orders we can match ourselves. */
  platformPurchases: integer("platform_purchases").notNull().default(0),
  platformValuePaise: paise("platform_value_paise").notNull().default(0),
  source: text("source").notNull(), // api | csv
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [uniqueIndex("store_ad_stats_day").on(t.storeId, t.platform, t.day, t.campaignId)]);

/** Storefront traffic per day (page views; unique visitors are counted in store_visitors). */
export const storeVisitsDaily = pgTable("store_visits_daily", {
  storeId: text("store_id").notNull().references(() => stores.id),
  day: text("day").notNull(),
  views: integer("views").notNull().default(0),
  visitors: integer("visitors").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.storeId, t.day] })]);

export const storeVisitors = pgTable("store_visitors", {
  storeId: text("store_id").notNull(),
  day: text("day").notNull(),
  /** sha256 of a random browser id + day: no personal data. */
  visitorHash: text("visitor_hash").notNull(),
}, (t) => [primaryKey({ columns: [t.storeId, t.day, t.visitorHash] })]);

// ---------- online store: plans, deposits, managed Meta Ads (phase 4) ----------
/** Store plans an admin sells (price includes GST). Paid from the shipping wallet. */
export const storePlans = pgTable("store_plans", {
  id: id(),
  name: text("name").notNull(),
  /** month | year */
  interval: text("interval").notNull(),
  pricePaise: paise("price_paise").notNull(),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
});

/** One row per plan purchase (also the receipt). */
export const storeSubscriptions = pgTable("store_subscriptions", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  planId: text("plan_id").notNull(),
  planName: text("plan_name").notNull(),
  interval: text("interval").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  basePaise: paise("base_paise").notNull(),
  gstPaise: paise("gst_paise").notNull(),
  periodStart: ts("period_start").notNull(),
  periodEnd: ts("period_end").notNull(),
  receiptNumber: text("receipt_number").notNull(),
  ledgerEntryId: text("ledger_entry_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdBy: text("created_by"),
  createdAt: created(),
}, (t) => [uniqueIndex("store_subscriptions_receipt").on(t.receiptNumber), uniqueIndex("store_subscriptions_idem").on(t.idempotencyKey), index("store_subscriptions_store").on(t.storeId, t.createdAt)]);

/** Managed Meta Ads security deposit, held from the wallet with its own ledger entry and receipt. */
export const storeDeposits = pgTable("store_deposits", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  /** held | refund_requested | refunded | forfeited */
  status: text("status").notNull().default("held"),
  receiptNumber: text("receipt_number").notNull(),
  ledgerEntryId: text("ledger_entry_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  termsVersion: integer("terms_version").notNull(),
  paidBy: text("paid_by"),
  refundRequestedAt: ts("refund_requested_at"),
  refundReason: text("refund_reason"),
  refundPaise: paise("refund_paise"),
  refundLedgerEntryId: text("refund_ledger_entry_id"),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
  decisionNote: text("decision_note"),
  createdAt: created(),
}, (t) => [uniqueIndex("store_deposits_receipt").on(t.receiptNumber), uniqueIndex("store_deposits_idem").on(t.idempotencyKey), index("store_deposits_store").on(t.storeId), index("store_deposits_status").on(t.status)]);

/** Managed Meta Ads service for a store: onboarding checklist, accepted terms, status. */
export const storeManagedAds = pgTable("store_managed_ads", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  /** onboarding | active | paused | ended */
  status: text("status").notNull().default("onboarding"),
  /** Manual checklist items: { [key]: { at, by, kind: "merchant" | "staff" } } */
  checklist: jsonb("checklist").notNull().default({}),
  termsVersion: integer("terms_version"),
  termsAcceptedAt: ts("terms_accepted_at"),
  termsAcceptedBy: text("terms_accepted_by"),
  /** Monthly ad spend ceiling the merchant agreed to (paid to Meta from their own ad account). */
  monthlyCapPaise: paise("monthly_cap_paise"),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [uniqueIndex("store_managed_ads_store").on(t.storeId), index("store_managed_ads_status").on(t.status)]);

/**
 * Campaign changes by Vishwaship staff. Anything that can raise spend (new campaign, budget increase, resume)
 * waits for the merchant's explicit approval; the rest is recorded as done. Together they are the change history.
 */
export const storeAdChanges = pgTable("store_ad_changes", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  /** new_campaign | budget_increase | budget_decrease | pause | resume | end | creative | note */
  kind: text("kind").notNull(),
  campaignName: text("campaign_name").notNull(),
  dailyBudgetPaise: paise("daily_budget_paise"),
  totalBudgetPaise: paise("total_budget_paise"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  details: text("details"),
  /** pending | approved | rejected | applied | withdrawn */
  status: text("status").notNull(),
  needsApproval: boolean("needs_approval").notNull(),
  proposedBy: text("proposed_by").notNull(),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
  decisionNote: text("decision_note"),
  appliedBy: text("applied_by"),
  appliedAt: ts("applied_at"),
  metaCampaignId: text("meta_campaign_id"),
  createdAt: created(),
}, (t) => [index("store_ad_changes_store").on(t.storeId, t.createdAt), index("store_ad_changes_status").on(t.status)]);

// ---------- online store: sale events & reviews (phase 5) ----------
/** A timed sale: % off for the whole store, some categories or some products. Prices are applied on the server. */
export const storeSaleEvents = pgTable("store_sale_events", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  /** whole percent, 1-90 */
  percentOff: integer("percent_off").notNull(),
  /** all | categories | products */
  scope: text("scope").notNull().default("all"),
  categoryIds: jsonb("category_ids").notNull().default([]),
  productIds: jsonb("product_ids").notNull().default([]),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  /** Bar text shown at the top of the store while the sale runs. */
  bannerText: text("banner_text"),
  active: boolean("active").notNull().default(true),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [index("store_sale_events_store").on(t.storeId, t.endsAt)]);

/** Buyer product reviews. Published at once; the merchant can hide or delete. */
export const storeReviews = pgTable("store_reviews", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id),
  orgId: text("org_id").notNull(),
  productId: text("product_id").notNull(),
  rating: integer("rating").notNull(),
  title: text("title"),
  body: text("body").notNull(),
  name: text("name").notNull(),
  /** Bought this product in this store (matched by the mobile on a placed order). The mobile itself is not kept. */
  verified: boolean("verified").notNull().default(false),
  /** published | hidden */
  status: text("status").notNull().default("published"),
  createdAt: created(),
}, (t) => [index("store_reviews_product").on(t.storeId, t.productId, t.status), index("store_reviews_store").on(t.storeId, t.createdAt)]);

// ---------- franchise ----------
/**
 * A franchise partner that Vishwaship appoints for one or more areas (districts / extra PINs).
 * Phase 1: admin-managed record, areas, security deposit and agreement. Login, referral and commission come later.
 */
export const franchises = pgTable("franchises", {
  id: id(),
  /** Short public code, e.g. VSF-0001 (also the future referral code). */
  code: text("code").notNull(),
  businessName: text("business_name").notNull(),
  ownerName: text("owner_name").notNull(),
  mobile: text("mobile").notNull(),
  email: text("email").notNull(),
  gstin: text("gstin"),
  pan: text("pan"),
  /** { line1, line2, city, state, pincode } */
  address: jsonb("address"),
  /** draft | active | suspended | terminated */
  status: text("status").notNull().default("draft"),
  statusReason: text("status_reason"),
  /** Deposit the admin set for this franchise (paise). */
  depositRequiredPaise: paise("deposit_required_paise").notNull().default(0),
  /** Minimum shipments per month expected by the agreement (0 = no target). */
  monthlyTargetShipments: integer("monthly_target_shipments").notNull().default(0),
  /** Agreement term (dates, IST calendar days stored as UTC midnight). */
  termStart: ts("term_start"),
  termEnd: ts("term_end"),
  /** Terms & Conditions version this franchise is on, and when the signed agreement was recorded. */
  termsVersion: integer("terms_version"),
  agreementSignedAt: ts("agreement_signed_at"),
  kycVerifiedAt: ts("kyc_verified_at"),
  notes: text("notes"),
  /** Franchise dashboard login (users.kind = "franchise"). */
  userId: text("user_id"),
  /**
   * Commission (phase 3). Vishwaship's price to the franchise = courier cost + base markup; the franchise sets its
   * customers' markup between min and max; commission = customer markup − base markup on the same cost, per delivered
   * shipment. Null base = commission not set up yet. commission_from: only shipments booked from this time count.
   */
  baseMarkupBps: integer("base_markup_bps"),
  minCustomerBps: integer("min_customer_bps"),
  maxCustomerBps: integer("max_customer_bps"),
  defaultCustomerBps: integer("default_customer_bps"),
  commissionFrom: ts("commission_from"),
  /** Payout bank details: holder name, last 4 digits only, IFSC (payment itself is made outside Vishwaship). */
  payoutAccountName: text("payout_account_name"),
  payoutAccountLast4: text("payout_account_last4"),
  payoutIfsc: text("payout_ifsc"),
  createdBy: text("created_by"),
  activatedAt: ts("activated_at"),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [uniqueIndex("franchises_code").on(t.code), index("franchises_status").on(t.status), uniqueIndex("franchises_user").on(t.userId)]);

/**
 * Areas given to a franchise. area_key is "d:<state>|<district>" or "p:<pincode>" (lower-case); an area can be held by only
 * one franchise at a time (partial unique index on live rows). Released rows stay as history.
 */
export const franchiseAreas = pgTable("franchise_areas", {
  id: id(),
  franchiseId: text("franchise_id").notNull().references(() => franchises.id),
  /** district | pincode */
  kind: text("kind").notNull(),
  state: text("state").notNull(),
  district: text("district"),
  pincode: text("pincode"),
  areaKey: text("area_key").notNull(),
  assignedBy: text("assigned_by"),
  releasedAt: ts("released_at"),
  releasedBy: text("released_by"),
  createdAt: created(),
}, (t) => [
  uniqueIndex("franchise_areas_live_key").on(t.areaKey).where(sql`released_at is null`),
  index("franchise_areas_franchise").on(t.franchiseId),
  index("franchise_areas_state").on(t.state),
]);

/** Security deposit received from a franchise (bank transfer / UPI / cheque), recorded by finance, with refund or forfeit. */
export const franchiseDeposits = pgTable("franchise_deposits", {
  id: id(),
  franchiseId: text("franchise_id").notNull().references(() => franchises.id),
  receiptNumber: text("receipt_number").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  /** bank_transfer | upi | cheque | cash */
  method: text("method").notNull(),
  /** UTR / cheque number (never card or account numbers). */
  reference: text("reference"),
  receivedOn: ts("received_on").notNull(),
  /** held | refunded | forfeited | partly_refunded */
  status: text("status").notNull().default("held"),
  refundPaise: paise("refund_paise").notNull().default(0),
  forfeitPaise: paise("forfeit_paise").notNull().default(0),
  refundReference: text("refund_reference"),
  decisionNote: text("decision_note"),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
  recordedBy: text("recorded_by").notNull(),
  createdAt: created(),
}, (t) => [uniqueIndex("franchise_deposits_receipt").on(t.receiptNumber), index("franchise_deposits_franchise").on(t.franchiseId)]);

/** Every published version of the franchise Terms & Conditions, so a franchise's agreement points at the exact text. */
export const franchiseTerms = pgTable("franchise_terms", {
  version: integer("version").primaryKey(),
  body: text("body").notNull(),
  createdBy: text("created_by"),
  createdAt: created(),
});

/** One commission line per delivered shipment of a franchise customer. */
export const franchiseCommissions = pgTable("franchise_commissions", {
  id: id(),
  franchiseId: text("franchise_id").notNull().references(() => franchises.id),
  orgId: text("org_id").notNull(),
  shipmentId: text("shipment_id").notNull(),
  /** Courier cost the markup applies to (pre-tax), from the booking quote. */
  eligiblePaise: paise("eligible_paise").notNull(),
  customerBps: integer("customer_bps").notNull(),
  baseBps: integer("base_bps").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  /** earned | in_payout | paid | void */
  status: text("status").notNull().default("earned"),
  payoutId: text("payout_id"),
  deliveredAt: ts("delivered_at").notNull(),
  /** IST month of delivery, e.g. 2026-11 (the payout period). */
  period: text("period").notNull(),
  voidReason: text("void_reason"),
  createdAt: created(),
}, (t) => [uniqueIndex("franchise_commissions_shipment").on(t.shipmentId), index("franchise_commissions_fr_period").on(t.franchiseId, t.period, t.status)]);

/** Monthly commission statement and payout for one franchise. */
export const franchisePayouts = pgTable("franchise_payouts", {
  id: id(),
  franchiseId: text("franchise_id").notNull().references(() => franchises.id),
  period: text("period").notNull(),
  statementNumber: text("statement_number").notNull(),
  shipments: integer("shipments").notNull(),
  grossPaise: paise("gross_paise").notNull(),
  tdsBps: integer("tds_bps").notNull(),
  tdsPaise: paise("tds_paise").notNull(),
  adjustmentPaise: paise("adjustment_paise").notNull().default(0),
  adjustmentNote: text("adjustment_note"),
  netPaise: paise("net_paise").notNull(),
  /** draft | approved | paid | cancelled */
  status: text("status").notNull().default("draft"),
  utr: text("utr"),
  paidOn: ts("paid_on"),
  createdBy: text("created_by").notNull(),
  approvedBy: text("approved_by"),
  approvedAt: ts("approved_at"),
  paidBy: text("paid_by"),
  note: text("note"),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
}, (t) => [uniqueIndex("franchise_payouts_statement").on(t.statementNumber), uniqueIndex("franchise_payouts_live_period").on(t.franchiseId, t.period).where(sql`status <> 'cancelled'`)]);
