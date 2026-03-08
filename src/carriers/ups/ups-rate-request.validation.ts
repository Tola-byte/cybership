import { z } from "zod";
import { RateRequest } from "../dtos/rate-request.dto";

const nonEmptyString = z.string().trim().min(1);

const addressSchema = z.object({
  street: nonEmptyString,
  city: nonEmptyString,
  stateCode: nonEmptyString,
  postalCode: nonEmptyString,
  countryCode: nonEmptyString,
});

const packageSchema = z.object({
  weightLbs: z.number().positive(),
  lengthIn: z.number().positive(),
  widthIn: z.number().positive(),
  heightIn: z.number().positive(),
});

const rateRequestSchema = z.object({
  origin: addressSchema,
  destination: addressSchema,
  package: packageSchema,
  serviceCode: z.string().trim().min(1).optional(),
});

export class ValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`RateRequest validation failed: ${issues.join("; ")}`);
    this.name = "ValidationError";
  }
}

export function validateRateRequest(request: RateRequest): void {
  const result = rateRequestSchema.safeParse(request);
  if (result.success) {
    return;
  }

  const issues = result.error.issues.map((issue) => {
    const field = issue.path.join(".");
    return `${field}: ${issue.message}`;
  });

  throw new ValidationError(issues);
}
