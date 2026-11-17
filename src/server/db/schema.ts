/**
 * Vishwaship schema. Money = bigint paise (mode "number"; safe up to ~9e13 rupees).
 * Percentages = integer basis points. Weights = integer grams. Dimensions = integer millimetres.
 * Every tenant-owned table carries org_id; queries go through tenant-scoped helpers.
 */
import { sql } from "drizzle-orm";
import {
  bigint, boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex,
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
  createdAt: created(),
});

export const users = pgTable("users", {
  id: id(),
  kind: text("kind").notNull(), // customer | staff
  orgId: text("org_id").references(() => orgs.id), // null for staff
  name: text("name").notNull(),
  email: text("email"),
  mobile: text("mobile"),
  emailVerifiedAt: ts("email_verified_at"),
  mobileVerifiedAt: ts("mobile_verified_at"),
  passwordHash: text("password_hash"),
  mustResetPassword: boolean("must_reset_password").notNull().default(false),
  staffRole: staffRole("staff_role"),
  mfaSecretEnc: text("mfa_secret_enc"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: created(),
}, (t) => [
  uniqueIndex("users_email_kind").on(t.kind, t.email),
  uniqueIndex("users_mobile_kind").on(t.kind, t.mobile),
]);

export const sessions = pgTable("sessions", {
  id: id(), // sha256 of the cookie token
  userId: text("user_id").notNull().references(() => users.id),
  createdAt: created(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  mfaPassed: boolean("mfa_passed").notNull().default(false),
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
  active: boolean("active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
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
  status: text("status").notNull().default("disabled"), // enabled | disabled | archived
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
  source: text("source").notNull().default("manual"), // manual | bulk | api | shopify | woocommerce | custom
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
  consignee: jsonb("consignee").notNull(), // name, mobile, address, pincode, city, state
  products: jsonb("products").notNull().default([]),
  invoiceNumber: text("invoice_number"),
  ewayBill: text("eway_bill"),
  buyerGstin: text("buyer_gstin"),
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
  lrNumber: text("lr_number"),
  pieceIds: jsonb("piece_ids"),
  bookingStatus: text("booking_status").notNull(), // pending | confirmed | failed | ambiguous | cancelled
  pickupStatus: text("pickup_status").notNull().default("not_scheduled"),
  labelStatus: text("label_status").notNull().default("not_generated"),
  status: text("status").notNull().default("booked"), // normalized tracking status
  quoteId: text("quote_id").notNull(),
  sellPaise: paise("sell_paise").notNull(),
  costPaise: paise("cost_paise").notNull(),
  reservationId: text("reservation_id"),
  chargeableWeightGrams: integer("chargeable_weight_grams").notNull(),
  carrierWeightGrams: integer("carrier_weight_grams"),
  etaDate: ts("eta_date"),
  lastEventAt: ts("last_event_at"),
  createdAt: created(),
}, (t) => [
  uniqueIndex("shipments_awb").on(t.provider, t.awb),
  index("shipments_org_status").on(t.orgId, t.status),
]);

export const shipmentEvents = pgTable("shipment_events", {
  id: id(),
  shipmentId: text("shipment_id").notNull().references(() => shipments.id),
  dedupeKey: text("dedupe_key").notNull(),
  status: text("status").notNull(),
  rawStatus: text("raw_status"),
  location: text("location"),
  occurredAt: ts("occurred_at").notNull(),
  source: text("source").notNull(), // webhook | poll | manual
  createdAt: created(),
}, (t) => [uniqueIndex("shipment_events_dedupe").on(t.dedupeKey)]);

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
  createdAt: created(),
});

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
  amountPaise: paise("amount_paise").notNull(),
  currency: text("currency").notNull().default("INR"),
  razorpayOrderId: text("razorpay_order_id").unique(),
  razorpayPaymentId: text("razorpay_payment_id").unique(),
  status: text("status").notNull().default("pending"), // pending | captured | failed | refunded | mismatch
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
});

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
  status: text("status").notNull(), // pending | confirmed | declined | expired | needs_review | send_failed
  sentAt: ts("sent_at"),
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
  status: text("status").notNull().default("open"),
  createdAt: created(),
});

export const ticketMessages = pgTable("ticket_messages", {
  id: id(),
  ticketId: text("ticket_id").notNull().references(() => tickets.id),
  authorUserId: text("author_user_id").notNull(),
  authorKind: text("author_kind").notNull(),
  body: text("body").notNull(),
  attachments: jsonb("attachments").notNull().default([]),
  createdAt: created(),
});

export const inAppAlerts = pgTable("in_app_alerts", {
  id: id(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  href: text("href"),
  readAt: ts("read_at"),
  createdAt: created(),
});

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
