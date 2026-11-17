/**
 * PIN -> city/district/state lookup. Production uses the India Post all-India pincode directory
 * (data.gov.in "All India Pincode Directory", loaded into a pincodes table by scripts/import-pincodes.ts).
 * This small offline prefix map is only a fallback so the form can suggest a state; the user can correct it.
 */
const STATE_BY_PREFIX: Array<[RegExp, string]> = [
  [/^11/, "Delhi"], [/^12|^13/, "Haryana"], [/^14|^15|^16/, "Punjab"], [/^17/, "Himachal Pradesh"], [/^18|^19/, "Jammu & Kashmir"],
  [/^20|^21|^22|^23|^24|^25|^26|^27|^28/, "Uttar Pradesh"], [/^24[6-9]|^26[23]/, "Uttarakhand"], [/^30|^31|^32|^33|^34/, "Rajasthan"],
  [/^36|^37|^38|^39/, "Gujarat"], [/^40|^41|^42|^43|^44/, "Maharashtra"], [/^45|^46|^47|^48/, "Madhya Pradesh"], [/^49/, "Chhattisgarh"],
  [/^50/, "Telangana"], [/^51|^52|^53/, "Andhra Pradesh"], [/^56|^57|^58|^59/, "Karnataka"], [/^60|^61|^62|^63|^64/, "Tamil Nadu"],
  [/^67|^68|^69/, "Kerala"], [/^70|^71|^72|^73|^74/, "West Bengal"], [/^75|^76|^77/, "Odisha"], [/^78/, "Assam"], [/^79/, "North East"],
  [/^80|^81|^82|^83|^84|^85/, "Bihar / Jharkhand"],
];
const CITY: Record<string, string> = { "110": "New Delhi", "400": "Mumbai", "411": "Pune", "560": "Bengaluru", "600": "Chennai", "700": "Kolkata", "500": "Hyderabad", "380": "Ahmedabad", "302": "Jaipur", "122": "Gurugram", "781": "Guwahati", "226": "Lucknow" };

export function guessPincode(pin: string): { city?: string; state?: string } {
  if (!/^[1-9]\d{5}$/.test(pin)) return {};
  const state = [...STATE_BY_PREFIX].reverse().find(([re]) => re.test(pin))?.[1];
  return { state, city: CITY[pin.slice(0, 3)] };
}
