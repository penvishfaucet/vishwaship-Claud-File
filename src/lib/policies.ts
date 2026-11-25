import { SITE } from "@/lib/site";

/**
 * Default text of the public policy pages (owner 2026-11-25: privacy, terms, refund, shipping). Admin → Website Content
 * → Policies edits and publishes them without a deployment; this text is used until something is published.
 * Plain text: blank lines separate paragraphs, lines starting with a number + "." are headings.
 */
const CONTACT = `${SITE.email} · ${SITE.phone} (${SITE.hours})`;
const UPDATED = "Last updated: 25 November 2026";

export const POLICY_DEFAULTS: Record<"privacy" | "terms" | "refund" | "shipping", string> = {
  privacy: `${UPDATED}

Vishwaship ("Vishwaship", "we", "us") runs vishwaship.com, vishwaship.in, the Vishwaship Android app and the online stores built on Vishwaship. This policy explains what personal data we collect, why, who we share it with and the choices you have. It follows the Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000.

1. What we collect
Account details: name, mobile number, email, business name, address, GSTIN and login details (password is stored only as a secure hash; Google and phone OTP sign-in are handled by Google / Firebase).
KYC and payout details: identity and business documents you upload for KYC, and the bank account you give us for COD payouts. Bank account numbers are stored encrypted; only the last 4 digits are shown.
Shipment details: pickup and delivery names, addresses, phone numbers, product description, weight, dimensions, invoice value, COD amount and tracking events.
Payments: wallet recharges and store payments are processed by our payment gateways (such as Razorpay and Cashfree). We do not see or store your card, UPI PIN or net-banking password; we receive only the payment reference and status.
Usage data: device and browser type, IP address and pages visited, used for security, fraud prevention and to improve the service.

2. Why we use it
To create and secure your account, verify KYC, quote rates, book shipments with courier partners, print labels, arrange pickups, track and deliver shipments, collect and pay COD, bill you and issue GST invoices, handle weight disputes, returns and support requests, send shipment updates (email, SMS, WhatsApp) and meet legal and tax obligations.

3. Who we share it with
Courier and logistics partners (and the aggregators we book through) receive the shipment details they need to pick up and deliver. Payment gateways and banks receive what they need to process payments and payouts. Service providers that run parts of our service for us (hosting, email, WhatsApp messaging, sign-in) process data only on our instructions. We disclose data when the law, a court or a government authority requires it. We do not sell personal data.

4. Cookies
We use cookies that are needed for the site to work (for example to keep you logged in). Analytics cookies are used only if you accept them in the cookie banner; you can change your choice at any time from the "Cookie settings" link in the footer.

5. How long we keep it
We keep account and shipment records for as long as your account is active and afterwards as long as tax, accounting and legal rules require (generally up to 8 years for invoices and financial records). KYC documents are kept for the period the law requires.

6. Security
Data is sent over HTTPS, secrets and bank details are encrypted, access by our staff is limited by role and every sensitive action is logged.

7. Your rights
You can view and correct your details in your account, ask for a copy of your data, withdraw consent for optional uses, and ask us to delete your account at vishwaship.com/account-deletion/ (records the law requires us to keep are retained until that period ends). Buyers whose address was shared with us by a seller may contact us the same way.

8. Contact and grievance officer
For any privacy question or complaint, write to the Grievance Officer, Vishwaship, Haridwar, Uttarakhand, India: ${CONTACT}. We reply within 30 days.

9. Changes
We may update this policy. The date at the top shows the latest version; important changes are also shown in your account.`,

  terms: `${UPDATED}

These terms apply to everyone who uses Vishwaship (vishwaship.com, vishwaship.in, the Vishwaship app, APIs and online stores built on Vishwaship). By creating an account or booking a shipment you agree to them.

1. The service
Vishwaship is a shipping platform. We compare rates and book shipments with independent courier and logistics partners, print labels, arrange pickups, track shipments and collect COD. The physical carriage is done by the courier partner chosen at booking, under that partner's conditions of carriage.

2. Your account
Give correct details and keep your login private; you are responsible for everything done from your account. KYC must be completed before COD and payouts. We may suspend an account that breaks these terms, the law or is used for fraud.

3. Wallet and charges
Shipping is prepaid from your Vishwaship wallet. The rate shown at booking (freight, fuel, COD and other charges, plus GST) is charged when the shipment is booked. Extra charges can apply afterwards: weight or size found higher by the courier, RTO (return to origin), re-attempts, address changes, storage and any charge the courier levies for the shipment. These are debited from the wallet and the wallet may go below zero; new bookings then need a recharge.

4. Weight discrepancies
Declare the actual weight and box size. If the courier's measured weight is higher, the difference is charged at your booking rate plus GST. You can dispute it with proof (photos of the packed box with weight and dimensions) within 7 days from the portal; undisputed charges are then final.

5. What you may not ship
No items banned by law or by the courier partner, including: explosives, weapons, drugs and narcotics, flammable or hazardous material, currency, precious metals and jewellery (unless the courier allows them), live animals, perishable goods without approval, and counterfeit or stolen goods. You are responsible for the contents, their packing and for correct invoices and e-way bills.

6. Packing and labels
Pack goods to survive transit. Print and paste the label exactly as downloaded from Vishwaship, one per carton; B2B shipments need the shipment document and invoice handed to the pickup person.

7. Loss and damage
Claims for loss or damage are settled as per the courier partner's liability terms and limits, up to the declared value or the courier's maximum, whichever is lower, and only with proof (invoice, packing and delivery evidence). Raise a claim within 7 days of delivery (damage) or of the expected delivery date (loss). We are not liable for indirect losses, loss of profit or delays caused by the courier, weather, strikes, government action or other events outside our control.

8. Cash on delivery (COD)
COD collected by the courier is paid to your registered bank account after the courier pays it to Vishwaship, normally the same or next working day after we receive it (Early COD subscribers: as per their plan). From each payout we deduct: the Online Store fee of 1.5% + GST on delivered COD orders of your Vishwaship online store, the Early COD fee + GST if you have Early COD, and any amount you owe us (negative wallet balance). Disputes about a COD amount must be raised within 30 days of the payout.

9. Cancellations and refunds
See the Refund & Cancellation policy.

10. Online stores
Store owners are the sellers of the goods sold on their store and are responsible for their products, prices, taxes, returns and their own policies to buyers. Vishwaship provides the store software and shipping.

11. Changes and law
We may change these terms or our rates; changes apply from the date they are published. These terms are governed by the laws of India and the courts at Haridwar, Uttarakhand have jurisdiction.

12. Contact
${CONTACT}`,

  refund: `${UPDATED}

1. Cancelling a shipment
A shipment can be cancelled from your account before the courier picks it up. The shipment charge is credited back to your Vishwaship wallet. Once a shipment has been picked up it cannot be cancelled; you can ask for it to be returned (RTO), which is charged.

2. Charges that are not refunded
Freight for a shipment that has been picked up, RTO charges, weight discrepancy charges you did not dispute in time, COD charges on delivered orders, and charges the courier levies for the shipment (re-attempts, address change, storage).

3. Weight dispute refunds
If your weight dispute is accepted, the extra charge is reversed to your wallet.

4. Wallet balance
Unused wallet balance can be refunded on request to support. We first settle any amount you owe; the rest is refunded to the original payment method or your registered bank account, normally within 7–10 working days of approval.

5. Failed or double payments
If money left your account but the recharge did not reach your wallet, it is either credited to the wallet or refunded by the payment gateway automatically, normally within 5–7 working days. Write to us with the payment reference if it does not arrive.

6. Plans and subscriptions
Plan and subscription fees (such as the Online Store plan) are for the period paid and are not refunded for a part period. You can cancel to stop the next renewal.

7. Orders from online stores
Returns, exchanges and refunds for goods bought on a store built on Vishwaship are handled by that store under its own policy.

8. Contact
${CONTACT}`,

  shipping: `${UPDATED}

1. Booking and pickup
Shipments are booked in your Vishwaship account with the courier partner you choose. Pickups are arranged from your registered pickup address, normally the same or next working day after booking (cut-off times and Sundays / holidays depend on the courier). Keep the shipment packed and labelled before the pickup person arrives.

2. Delivery time
The delivery time shown at booking is the courier's estimate for the route, counted from pickup. It is not a guarantee: delays can happen because of weather, festivals, strikes, remote areas, government restrictions or incorrect addresses.

3. Coverage
We ship across India to the PIN codes the chosen courier serves. Serviceability, COD availability and the estimated delivery date are shown when you check rates. International shipping is available only where enabled for your account.

4. Tracking
Every shipment gets an AWB or LR number. Track it in your account, on vishwaship.com/track/ or on your own branded tracking page. Buyers receive shipment updates where notifications are switched on.

5. Failed delivery and returns (NDR / RTO)
If the courier cannot deliver (buyer not available, refused, wrong address), the shipment appears in your NDR list to re-attempt or return. Shipments not delivered after the courier's attempts are returned to your pickup address (RTO); RTO charges apply.

6. Weight and size
Charges depend on the higher of actual and volumetric weight (L × B × H in cm ÷ the courier's divisor). The courier may re-measure; see the Terms for weight discrepancies.

7. Damaged or missing shipments
Check the package at delivery. Report damage within 7 days of delivery and loss within 7 days of the expected delivery date, with photos and the invoice, so we can raise the claim with the courier.

8. Contact
${CONTACT}`,
};
