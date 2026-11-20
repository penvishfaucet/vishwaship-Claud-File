package `in`.vishwaship.app

import `in`.vishwaship.app.core.Money
import `in`.vishwaship.app.core.Validators
import `in`.vishwaship.app.core.Weights
import `in`.vishwaship.app.data.AppJson
import `in`.vishwaship.app.data.OrderDetail
import `in`.vishwaship.app.data.QuoteResult
import `in`.vishwaship.app.push.Push
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CoreTest {
    @Test fun moneyParsesRupeesToPaiseExactly() {
        assertEquals(123450L, Money.parseRupees("1,234.50"))
        assertEquals(1L, Money.parseRupees("0.01"))
        assertNull(Money.parseRupees("12.345"))
        assertNull(Money.parseRupees("-5"))
        assertNull(Money.parseRupees("abc"))
    }

    @Test fun weightPreviewMatchesWebFormula() {
        // 2 identical boxes 30x20x10 cm, 1.2 kg each: actual 2.4 kg; volumetric 2 x 1.2 kg (6000 cm3 / 5000)
        val s = Weights.summarize(listOf(Weights.Box(2, 30.0, 20.0, 10.0, 1.2)))
        assertEquals(2, s.boxes)
        assertEquals(2.4, s.actualKg, 1e-9)
        assertEquals(2.4, s.volumetricKg, 1e-9)
        val big = Weights.summarize(listOf(Weights.Box(1, 50.0, 40.0, 40.0, 3.0), Weights.Box(3, 10.0, 10.0, 10.0, 0.5)))
        assertEquals(4, big.boxes)
        assertEquals(16.6, big.volumetricKg, 1e-9) // 16 kg + 3 x 0.2 kg
        assertEquals(big.volumetricKg, big.estimatedChargeableKg, 1e-9)
    }

    @Test fun validatorsFollowServerRules() {
        assertEquals("9876543210", Validators.mobile("+91 98765 43210"))
        assertEquals("9876543210", Validators.mobile("09876543210"))
        assertNull(Validators.mobile("1234567890"))
        assertTrue(Validators.pin.matches("110001")); assertTrue(!Validators.pin.matches("011000"))
        assertTrue(Validators.addressText("12/A, MG Road - Near #5")); assertTrue(!Validators.addressText("Flat <1>"))
        assertTrue(Validators.utr.matches("UTR123456")); assertTrue(!Validators.utr.matches("12345"))
    }

    @Test fun pushLinksAreRestrictedToKnownRoutes() {
        assertEquals("/orders/ord_1", Push.safeLink("/orders/ord_1"))
        assertEquals("/alerts", Push.safeLink("https://evil.example/x"))
        assertEquals("/alerts", Push.safeLink("/orders/../../etc"))
        assertEquals("/wallet", Push.safeLink("/wallet"))
        assertEquals("/alerts", Push.safeLink(null))
    }

    @Test fun urlsUseTheSitesTrailingSlashForm() {
        val b = "https://vishwaship.in"
        assertEquals("https://vishwaship.in/api/portal/quote/", `in`.vishwaship.app.data.slashUrl(b, "/api/portal/quote"))
        assertEquals("https://vishwaship.in/api/portal/labels/?ids=s1&format=thermal_4x6", `in`.vishwaship.app.data.slashUrl(b, "/api/portal/labels?ids=s1&format=thermal_4x6"))
        assertEquals("https://vishwaship.in/pay/cashfree/#sid=a?b&mode=sandbox", `in`.vishwaship.app.data.slashUrl("$b/", "/pay/cashfree/#sid=a?b&mode=sandbox"))
        assertEquals("https://vishwaship.in/api/mobile/v1/me/", `in`.vishwaship.app.data.slashUrl(b, "/api/mobile/v1/me/"))
    }

    @Test fun parsesServerOrderAndQuoteShapes() {
        val order = """{"order":{"id":"ord_1","orderNumber":"A-1","createdAt":"2026-11-19T10:00:00.000Z","mode":"B2C","orderStatus":"booked","payment":"cod","codPaise":50000,
            "boxes":2,"actualGrams":1000,"volumetricGrams":800,"chargeableGrams":1000,"consignee":{"name":"R","pincode":"110001"},"warehouseId":"wh_1",
            "shipment":{"id":"shp_1","carrierCode":"delhivery","carrierName":"Delhivery","serviceName":"Surface","awb":"123","bookingStatus":"confirmed","status":"in_transit","pickupStatus":"picked_up","labelFormats":["thermal_4x6","thermal_3x4"],"cancellable":false},
            "unknownFutureField":true},"timeline":[{"status":"in_transit","at":"2026-11-19T12:00:00.000Z","location":"Delhi"}],"ndr":null}"""
        val d = AppJson.decodeFromString(OrderDetail.serializer(), order)
        assertEquals("123", d.order.shipment?.awb)
        assertEquals(2, d.order.boxes)
        assertEquals("wh_1", d.order.warehouseId)
        val q = AppJson.decodeFromString(QuoteResult.serializer(), """{"offers":[{"quoteId":"q1","carrierCode":"delhivery","carrierName":"Delhivery","serviceName":"Surface","mode":"B2C","chargeableWeightGrams":1000,"lines":[{"code":"freight","label":"Freight","sellPreTax":5000}],"sellingSubtotal":5000,"gst":900,"total":5900,"expiresAt":"2026-11-19T12:00:00.000Z","isDemo":false,"pending":null,"paymentMode":"prepaid","payer":{"sender":5900,"receiver":0}}],"unavailable":0,"notices":[]}""")
        assertEquals(5900L, q.offers.single().total)
    }
}
