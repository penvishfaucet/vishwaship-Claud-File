/**
 * Shipmozo adapter. Endpoint paths and payloads are filled in from the supplied API contract
 * (Downloads/Shipmozo.pdf) in the next step. Until then every operation reports "unsupported" so
 * an enabled Shipmozo account can never produce a fake quote or AWB.
 */
import { type ShippingAdapter, unsupported } from "./types";

export const shipmozoAdapter: ShippingAdapter = {
  key: "shipmozo",
  displayName: "Shipmozo",
  implemented: [],
  async health() { return unsupported("health"); },
  async quote() { return unsupported("quote"); },
  async book() { return unsupported("book"); },
  async lookupBooking() { return unsupported("booking lookup"); },
  async label() { return unsupported("label"); },
  async schedulePickup() { return unsupported("pickup"); },
  async track() { return unsupported("track"); },
  async cancel() { return unsupported("cancel"); },
  async ndrAction() { return unsupported("NDR action"); },
};
