import { z } from "zod";
import type { QuoteRequest } from "@/server/providers/types";
import { rupeesToPaise } from "@/lib/money";
import { FOD_RULE_TEXT, chargeableKg, fodAllowed } from "@/lib/payment";

const pin = z.string().regex(/^[1-9]\d{5}$/, "Must be a valid 6-digit PIN code");

export const QuoteInput = z.object({
  mode: z.enum(["B2C", "B2B"]),
  originPincode: pin,
  destinationPincode: pin,
  paymentType: z.enum(["prepaid", "cod", "fod"]),
  codAmountRupees: z.number().min(0).max(5_00_000).optional(),
  declaredValueRupees: z.number().min(0).max(50_00_000).optional(),
  packages: z.array(z.object({
    count: z.number().int().min(1).max(500),
    lengthCm: z.number().positive().max(500),
    breadthCm: z.number().positive().max(500),
    heightCm: z.number().positive().max(500),
    weightKg: z.number().positive().max(5000),
  })).min(1).max(50),
}).refine((v) => v.paymentType !== "cod" || (v.codAmountRupees ?? 0) > 0, { message: "COD amount is required for COD", path: ["codAmountRupees"] })
  .refine((v) => v.paymentType !== "fod" || v.mode === "B2B", { message: "FOD is only for B2B orders", path: ["paymentType"] })
  .refine((v) => v.paymentType !== "fod" || fodAllowed(chargeableKg(v.packages)), { message: `FOD is ${FOD_RULE_TEXT.toLowerCase()}`, path: ["paymentType"] });

export function toQuoteRequest(v: z.infer<typeof QuoteInput>): QuoteRequest {
  return {
    mode: v.mode,
    originPincode: v.originPincode,
    destinationPincode: v.destinationPincode,
    paymentType: v.paymentType,
    codAmount: v.paymentType === "cod" || v.paymentType === "fod" ? rupeesToPaise(v.codAmountRupees ?? 0) : 0, // FOD + COD keeps its amount
    declaredValue: rupeesToPaise(v.declaredValueRupees ?? v.codAmountRupees ?? 0),
    packages: v.packages.map((p) => ({
      count: p.count,
      lengthMm: Math.round(p.lengthCm * 10), breadthMm: Math.round(p.breadthCm * 10), heightMm: Math.round(p.heightCm * 10),
      actualWeightGrams: Math.round(p.weightKg * 1000),
    })),
  };
}
