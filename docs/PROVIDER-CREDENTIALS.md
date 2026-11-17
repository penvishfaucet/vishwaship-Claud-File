# API credentials — कौन-सी key कहाँ से मिलेगी और कहाँ डालनी है

## 1. Vishwaship की अपनी API (`/api/v1`)

| कौन बना सकता है | कहाँ |
| --- | --- |
| Owner (एडमिन) — किसी भी ग्राहक के लिए | **Admin Portal → Settings → API Credentials** (`/admin/api-credentials/`) |
| ग्राहक — सिर्फ़ अपने अकाउंट के लिए | **Customer Portal → Integrations → API Credentials** (`/portal/integrations/?tab=api`) |

- **Generate Key** दबाने पर **API Key** (जैसे `vsk_…`) और **API Secret** बनते हैं। Secret **सिर्फ़ एक बार** दिखता है; database में उसका केवल hash रहता है।
- **Rotate**: उसी API Key के लिए नया Secret बनता है, पुराना Secret तुरंत बंद हो जाता है।
- **Revoke**: key हमेशा के लिए बंद।
- इस्तेमाल: `Authorization: Bearer <API Key>.<API Secret>` header के साथ `/api/v1/...` पर request।
- हर create / rotate / revoke Audit Log में दर्ज होता है। इनके लिए कोई environment variable नहीं चाहिए।

## 2. थर्ड-पार्टी providers (carrier, payment, WhatsApp, email)

**ये keys environment variables में नहीं डाली जातीं।** इन्हें **Admin Portal → Integrations → (provider) → Manage → Configuration** में डालें। वहाँ ये `APP_ENCRYPTION_KEY` से encrypt होकर database में रहती हैं, बाद में दिखाई नहीं देतीं (सिर्फ़ बदली जा सकती हैं), logs/exports में नहीं आतीं, और बदलने के लिए redeploy नहीं करना पड़ता।
सर्वर के environment variables सिर्फ़ ये हैं: `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `APP_URL`, `OWNER_EMAIL`, `OWNER_NAME` (देखें `.env.example`)।

| Provider | Vishwaship में स्थिति | कौन-सी credential चाहिए | कहाँ से मिलेगी | Admin → Integrations में field |
| --- | --- | --- | --- | --- |
| **Shipmozo** | Adapter तैयार नहीं — API दस्तावेज़ (DOC-20261105-WA0093.pdf) का इंतज़ार | Public key + Private key (API headers) | Shipmozo panel का API/Developer section, या आपका Shipmozo account manager | `publicKey`, `privateKey` |
| **Delhivery B2C** | Adapter required | API Token (`Authorization: Token …`), रजिस्टर्ड pickup location का नाम, staging और live के अलग token | Delhivery One panel → Developer / API setup; staging token के लिए Delhivery account manager | (adapter बनने पर) `apiToken`, `pickupLocationName` |
| **Delhivery B2B (LTL)** | Adapter required | API username + password (इनसे login token बनता है), client/warehouse code | Delhivery B2B account manager / Delhivery One developer portal (B2B) | (adapter बनने पर) `username`, `password`, `clientCode` |
| **Shiprocket** | Adapter required | API user email + password (अलग "API user") | Shiprocket panel → Settings → API → Configure → Create API User | (adapter बनने पर) `apiEmail`, `apiPassword` |
| **Razorpay** | Implemented, credentials बाकी | Key ID, Key Secret, Webhook Secret | Razorpay Dashboard → Account & Settings → API Keys (Test और Live अलग); Webhooks में URL `https://<आपका-domain>/api/webhooks/razorpay`, events `payment.captured`, `order.paid` | `keyId`, `keySecret`, `webhookSecret` |
| **WATI (WhatsApp)** | Implemented (demo mode में verified; live account बाकी) | API endpoint URL, Access token, approved template के नाम | WATI dashboard → API Docs / Integrations | `apiEndpoint`, `accessToken`, `webhookToken` |
| **Resend (email)** | Sending बाकी | API key + verified sending domain | resend.com → API Keys, Domains | `apiKey` |
| **Custom SMTP** | Sending बाकी | Host, port, username, password | आपका email provider | `host`, `port`, `username`, `password` |
| **SMS / OTP** | Provider चुनना बाकी | API key, DLT sender ID, DLT-approved template IDs | आपका SMS provider + DLT portal | `apiKey`, `senderId` |
| **Shopify / WooCommerce (stores)** | Implemented | Shopify Admin API token / WooCommerce consumer key + secret | देखें Customer Portal → Integrations → Stores पर लिखे steps | ग्राहक खुद Stores tab में डालता है |

### आपकी तरफ़ से क्या चाहिए
1. **Shipmozo**: API दस्तावेज़ `DOC-20261105-WA0093.pdf` और Shipmozo पर API access चालू है या नहीं (B2B/B2C, NDR, pickup की अनुमति)।
2. **Delhivery**: B2C और/या B2B के API दस्तावेज़/account access, staging token, और pickup location के नाम।
3. **Razorpay**: Test mode keys पहले (live बाद में)।
4. **WATI**: account, sender number और Meta-approved COD Confirm/Cancel template।

Credentials कभी चैट, ईमेल, स्क्रीनशॉट या GitHub में न भेजें — सीधे Admin → Integrations में खुद डालें।

## WhatsApp (WATI) setup — Out for Delivery + COD Confirmation

1. **WATI account** बनाएँ और अपना WhatsApp Business sender number जोड़ें (Meta verification WATI करवाता है)।
2. WATI में दो templates बनाकर Meta approval के लिए भेजें:
   - `out_for_delivery_v1` (Utility) — variables: `{{buyer_name}}`, `{{order_id}}`, `{{merchant_name}}`, `{{carrier}}`, `{{awb}}`, `{{tracking_link}}`
   - `cod_confirm_v1` (Utility) — variables: `{{buyer_name}}`, `{{order_id}}`, `{{merchant_name}}`, `{{cod_amount}}`, और दो **Quick Reply buttons**: बिल्कुल `Confirm Order` और `Cancel Order`
3. WATI → API Docs से **API endpoint** (जैसे `https://live-mt-server.wati.io/<tenant-id>`) और **Access token** कॉपी करें।
4. एक लंबा random **webhook token** बनाएँ (कम से कम 32 अक्षर)।
5. Admin → Integrations → WATI में `apiEndpoint`, `accessToken`, `webhookToken` डालें; *allowed hosts* में WATI का host (जैसे `live-mt-server.wati.io`) डालें; account को **Enabled** करें और *Test* दबाएँ।
6. WATI → Webhooks में URL डालें: `https://<आपकी-site>/api/webhooks/wati?token=<webhookToken>` — events: *Message received* और *Sent message status*।
7. Admin → WhatsApp Ops → Template mapping में दोनों template के नाम डालें और Meta approve होने पर **Approved** चुनें (सिर्फ़ Approved templates से live भेजा जाता है)।
8. Admin → Plans & Features में plan बनाएँ जिसमें *WhatsApp notifications* module + दोनों events हों, और ग्राहक को plan दें। ग्राहक फिर Settings → Shipping Notifications / COD Confirmation में चालू करे।
9. COD का no-response timeout और उसके बाद क्या हो (order active रखें / review / cancel) Admin → WhatsApp Ops में सेट करें।

Environment में कुछ नया नहीं चाहिए — `APP_URL` सही होना चाहिए (tracking link और webhook URL उसी से बनते हैं)। जब तक WATI account जुड़ा नहीं है, local/dev में **demo mode** चलता है (message सिर्फ़ record होते हैं, credits नहीं कटते); production में demo mode कभी चालू नहीं होता।
