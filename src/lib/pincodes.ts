/**
 * PIN -> city/district/state lookup. Production uses the India Post pincode directory (src/server/pincode.ts).
 * This offline prefix map is only a fallback for when the directory is down, so the form can still suggest a
 * real state (the user can correct it). Later entries win, so the narrower prefixes are listed last.
 */
const STATE_BY_PREFIX: Array<[RegExp, string]> = [
  [/^11/, "Delhi"], [/^1[23]/, "Haryana"], [/^1[456]/, "Punjab"], [/^160/, "Chandigarh"], [/^17/, "Himachal Pradesh"],
  [/^1[89]/, "Jammu & Kashmir"], [/^1941/, "Ladakh"],
  [/^2[0-8]/, "Uttar Pradesh"], [/^24[6-9]|^2447|^262[5-9]|^263/, "Uttarakhand"],
  [/^3[0-4]/, "Rajasthan"], [/^3[6-9]/, "Gujarat"],
  [/^4[0-4]/, "Maharashtra"], [/^403/, "Goa"], [/^4[5-8]/, "Madhya Pradesh"], [/^49/, "Chhattisgarh"],
  [/^50/, "Telangana"], [/^5[1-3]/, "Andhra Pradesh"], [/^5[6-9]/, "Karnataka"],
  [/^6[0-4]/, "Tamil Nadu"], [/^6[7-9]/, "Kerala"],
  [/^7[0-4]/, "West Bengal"], [/^737/, "Sikkim"], [/^744/, "Andaman and Nicobar Islands"],
  [/^7[5-7]/, "Odisha"], [/^78/, "Assam"],
  [/^79[0-2]/, "Arunachal Pradesh"], [/^79[34]/, "Meghalaya"], [/^795/, "Manipur"], [/^796/, "Mizoram"], [/^79[78]/, "Nagaland"], [/^799/, "Tripura"],
  [/^8[0-5]/, "Bihar"], [/^81[4-6]|^82[5-9]|^83[0-5]/, "Jharkhand"],
];
const CITY: Record<string, string> = { "110": "New Delhi", "400": "Mumbai", "411": "Pune", "560": "Bengaluru", "600": "Chennai", "700": "Kolkata", "500": "Hyderabad", "380": "Ahmedabad", "302": "Jaipur", "122": "Gurugram", "781": "Guwahati", "226": "Lucknow", "799": "West Tripura" };

export function guessPincode(pin: string): { city?: string; state?: string } {
  if (!/^[1-9]\d{5}$/.test(pin)) return {};
  const state = [...STATE_BY_PREFIX].reverse().find(([re]) => re.test(pin))?.[1];
  return { state, city: CITY[pin.slice(0, 3)] };
}
