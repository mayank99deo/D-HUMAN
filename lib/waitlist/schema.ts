import "server-only";
import { z } from "zod";
import { PLAN_VALUES, SOURCE_VALUES, TRAINING_VALUES } from "./options";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

export const joinSchema = z.object({
  email,
  source: z.enum(SOURCE_VALUES).default("hero"),
  utmSource: optionalText(100),
  utmMedium: optionalText(100),
  utmCampaign: optionalText(100),
  referrer: optionalText(500),
  // Honeypot. Real people never see this field, so any value means a bot.
  company: optionalText(200),
});

export const detailsSchema = z.object({
  email,
  token: z.string().min(16).max(128),
  firstName: optionalText(60),
  city: optionalText(80),
  plan: z.enum(PLAN_VALUES).optional(),
  training: z.array(z.enum(TRAINING_VALUES)).max(TRAINING_VALUES.length).default([]),
  whatsapp: z
    .string()
    .trim()
    .max(20)
    .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a phone number with country code, like +91 98765 43210")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type JoinInput = z.infer<typeof joinSchema>;
export type DetailsInput = z.infer<typeof detailsSchema>;
