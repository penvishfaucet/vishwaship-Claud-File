export const SITE = {
  name: "Vishwaship.com",
  phone: "+91 9997404427",
  email: "support@vishwaship.com",
  hours: "Mon–Sat, 10 AM – 7 PM",
};

/** Carriers shown in the public partner strip. Owner must confirm this list is currently approved. */
export const CARRIERS: Array<{ code: string; name: string }> = [
  { code: "delhivery", name: "Delhivery" },
  { code: "blue-dart", name: "Blue Dart" },
  { code: "dtdc", name: "DTDC" },
  { code: "xpressbees", name: "Xpressbees" },
  { code: "ecom-express", name: "Ecom Express" },
  { code: "ekart", name: "Ekart" },
  { code: "amazon-shipping", name: "Amazon Shipping" },
  { code: "shadowfax", name: "Shadowfax" },
  { code: "fedex-express", name: "FedEx Express" },
  { code: "dhl", name: "DHL" },
  { code: "india-post", name: "India Post" },
  { code: "aramex", name: "Aramex" },
  { code: "ups", name: "UPS" },
  { code: "allcargo-gati", name: "Allcargo Gati" },
  { code: "tci-express", name: "TCI Express" },
  { code: "tci", name: "TCI" },
  { code: "trackon", name: "Trackon" },
  { code: "the-professional-couriers", name: "The Professional Couriers" },
  { code: "shree-maruti", name: "Shree Maruti" },
  { code: "dp-world", name: "DP World" },
  { code: "porter", name: "Porter" },
  { code: "borzo", name: "Borzo" },
  { code: "allcargo-logistics", name: "Allcargo Logistics" },
];

export const carrierLogo = (code: string) =>
  CARRIERS.some((c) => c.code === code) ? `/couriers/${code}.webp` : null;
