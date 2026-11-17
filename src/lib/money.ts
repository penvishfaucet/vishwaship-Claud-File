/**
 * All money is integer paise (1 INR = 100 paise). Never use floats for stored amounts.
 * Percentages are stored as basis points (1% = 100 bps) so 25% = 2500, 12.5% = 1250.
 */
export type Paise = number;
export type Bps = number;

export function assertPaise(v: number, label = "amount"): asserts v is Paise {
  if (!Number.isSafeInteger(v)) throw new Error(`${label} must be an integer number of paise, got ${v}`);
}

/** Round half away from zero on an exact rational: (value * num) / den. */
export function mulDivRound(value: Paise, num: number, den: number): Paise {
  assertPaise(value);
  const n = BigInt(value) * BigInt(num);
  const d = BigInt(den);
  const q = n / d;
  const r = n % d;
  const twice = (r < 0n ? -r : r) * 2n;
  const adj = twice >= (d < 0n ? -d : d) ? (n < 0n !== d < 0n ? -1n : 1n) : 0n;
  return Number(q + adj);
}

/** Apply a percentage expressed in bps: e.g. applyBps(10000, 2500) = 2500 paise. */
export function pctOf(value: Paise, bps: Bps): Paise {
  return mulDivRound(value, bps, 10_000);
}

export function rupeesToPaise(rupees: number | string): Paise {
  const s = typeof rupees === "number" ? rupees.toFixed(2) : rupees.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid INR amount: ${rupees}`);
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const p = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return s.startsWith("-") ? -p : p;
}

export function formatINR(paise: Paise): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = String(abs % 100).padStart(2, "0");
  // Indian digit grouping: 12,34,567
  const s = String(rupees);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}₹${rest ? rest + "," : ""}${last3}.${p}`;
}
