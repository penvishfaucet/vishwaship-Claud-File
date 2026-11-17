# Delhivery Direct — API reference used by Vishwaship (read from one.delhivery.com developer portal, 2026-11-17)

## B2B (LTL) — `src/server/providers/delhivery-b2b.ts`
Base: test `https://ltl-clients-api-dev.delhivery.com` · production `https://ltl-clients-api.delhivery.com`
Auth: `POST /ums/login {username, password}` → JWT, valid 24 h, sent as `Authorization: Bearer <jwt>`.
Do not log in per request (100 logins / 5 min / IP; 10-minute lock after wrong credentials) — the token is cached.

| Purpose | Call | Notes |
|---|---|---|
| Serviceability | `GET /pincode-service/{pin}?weight=<g>` | |
| Expected TAT | `GET /tat/estimate?origin_pin=&destination_pin=` | days |
| Freight estimate | `POST /freight/estimate` `{dimensions:[{length_cm,width_cm,height_cm,box_count}], weight_g, source_pin, consignee_pin, payment_mode:"cod"\|"prepaid", cod_amount, inv_amount, freight_mode:"fop"\|"fod", rov_insurance, cheque_payment}` | estimate only; freight_mode mandatory for B2BR (retail) clients |
| Freight breakup (actual) | `GET /lrn/freight-breakup?lrns=a,b` (max 25) | used for reconciliation |
| Register warehouse | `POST /client-warehouse/create/` `{name, pin_code, city, state, country, address_details:{address, contact_person, phone_number}, same_as_fwd_add}` | name is case/space-sensitive in manifest |
| Book (async) | `POST /manifest` multipart: `pickup_location_name, payment_mode, cod_amount, weight (g), dropoff_location (json), shipment_details (json list: order_id, box_count, description, weight, waybills, master), dimensions (json list, cm), invoices (json list: inv_num, inv_amt, ewaybill, inv_qr_code), rov_insurance, freight_mode fop/fod, fm_pickup, billing_address (json)` | returns **job_id** |
| Booking status | `GET /manifest?job_id=` | LR (`lrn`) + AWBs (n boxes + 1 document AWB unless paperless) |
| Track | `GET /lrn/track?lrnum=` | latest status only: MANIFESTED, PICKED_UP, LEFT_ORIGIN, REACH_DESTINATION, UNDEL_REATTEMPT, PART_DEL, OFD, DELIVERED, RETURNED_INTRANSIT, RECEIVED_AT_RETURN_CENTER, RETURN_OFD, RETURN_DELIVERED, NOT_PICKED, LOST |
| Cancel | `DELETE /lrn/cancel/{lrn}` | allowed while Manifested / In Transit / Pending / Open / Scheduled |
| Pickup request | `POST /pickup_requests/` `{client_warehouse, pickup_date YYYY-MM-DD, start_time HH:MM:SS, expected_package_count}`; header `X-Request-Id` (idempotency) | |
| Label | `GET /label/get_urls/{sm\|md\|a4\|std}/{lrn}` | list of links with Base64 PNG per waybill |
| Webhook | configured by Delhivery on request (lastmile-integration@delhivery.com); status push UD/DL/RT | |

**FOD**: documented only for B2B as `freight_mode: "fod"` (estimate and manifest). How Delhivery collects / settles FOD and whether it can collect Vishwaship’s marked-up freight is **not documented** — must be confirmed with the Delhivery account manager.

## B2C (Express) — `src/server/providers/delhivery-b2c.ts`
Base: test `https://staging-express.delhivery.com` · production `https://track.delhivery.com`
Auth: `Authorization: Token <api token>` (static token from Delhivery ONE panel).

| Purpose | Call | Notes |
|---|---|---|
| Serviceability | `GET /c/api/pin-codes/json/?filter_codes=<pin>` | `delivery_codes[].postal_code` with `pre_paid`, `cash`, `pickup` flags |
| Expected TAT | `GET /api/dc/expected_tat?origin_pin=&destination_pin=&mot=S\|E&pdt=B2C` | |
| Shipping cost | `GET /api/kinko/v1/invoice/charges/.json?md=E\|S&ss=Delivered&d_pin=&o_pin=&cgm=<g>&pt=Pre-paid\|COD&l=&b=&h=` | estimate; returns `total_amount` + component charges |
| Book | `POST /api/cmu/create.json` body `format=json&data=<json>` (URL-encoded recommended) `{pickup_location:{name}, shipments:[{name, order, phone, add, pin, city, state, country, payment_mode:"Prepaid"\|"COD"\|"Pickup"\|"REPL", cod_amount, total_amount, weight (g), shipment_length/width/height (cm), products_desc, hsn_code, ewbn, seller_inv, shipping_mode Surface\|Express, waybill}]}` | synchronous; returns `packages[].waybill` |
| Track | `GET /api/v1/packages/json/?waybill=&ref_ids=` | full scan history |
| Cancel | `POST /api/p/edit {waybill, cancellation:"true"}` | |
| Label | `GET /api/p/packing_slip?wbns=&pdf=true&pdf_size=4R\|A4` | S3 PDF link |
| Pickup | `POST /fm/request/new/ {pickup_time, pickup_date, pickup_location, expected_package_count}` | |
| Register warehouse | `POST /api/backend/clientwarehouse/create/ {name, phone, address, city, pin, country, email, registered_name, return_*}` | |

**FOD is not a documented B2C payment mode** (only Prepaid, COD, Pickup, REPL). B2C FOD therefore stays disabled unless Delhivery provides an account-specific method in writing.

Response bodies are not published on the portal; the adapters parse them defensively and store the raw provider reference for support.
