import { z } from "zod";

import type {
  GlobalSkillCatalog,
  GlobalSkillCatalogEntry,
  GlobalSkillProviderSupport,
  GlobalSkillUpdate,
  ProviderIntegrationCatalog,
  ProviderIntegrationCatalogEntry,
  ProviderIntegrationUpdate,
} from "./types.js";

export const GlobalSkillProviderSupportSchema: z.ZodType<GlobalSkillProviderSupport> = z
  .object({
    providerId: z.string().min(1),
    providerLabel: z.string().min(1),
  })
  .strict();

export const GlobalSkillCatalogEntrySchema: z.ZodType<GlobalSkillCatalogEntry> = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    summary: z.string().nullable(),
    enabled: z.boolean(),
    providerSupport: z.array(GlobalSkillProviderSupportSchema).default([]),
  })
  .strict();

export const GlobalSkillCatalogSchema: z.ZodType<GlobalSkillCatalog> = z
  .object({
    skills: z.array(GlobalSkillCatalogEntrySchema).default([]),
  })
  .strict();

export const GlobalSkillUpdateSchema: z.ZodType<GlobalSkillUpdate> = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export const ProviderIntegrationCatalogEntrySchema: z.ZodType<ProviderIntegrationCatalogEntry> = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const ProviderIntegrationCatalogSchema: z.ZodType<ProviderIntegrationCatalog> = z
  .object({
    providerId: z.string().min(1),
    providerLabel: z.string().min(1),
    integrations: z.array(ProviderIntegrationCatalogEntrySchema).default([]),
  })
  .strict();

export const ProviderIntegrationUpdateSchema: z.ZodType<ProviderIntegrationUpdate> = z
  .object({
    enabledIds: z.array(z.string().min(1)),
  })
  .strict();
