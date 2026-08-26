import { z } from "zod";

export const workspaceIdSchema = z.string().uuid();

export const syncIntervalSchema = z.enum(["manual", "24h"]);

export const watchedTaxonomySchema = z.object({
  ref: z.string().min(1).max(300),
  title: z.string().max(300).default(""),
  productCount: z.number().int().nonnegative().max(10_000_000).optional(),
});

export const createRuleBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: z.string().uuid(),
  name: z.string().min(1).max(120),
  interval: syncIntervalSchema.default("24h"),
  mode: z.enum(["auto", "review"]).default("auto"),
  watchedTaxonomies: z.array(watchedTaxonomySchema).min(1).max(50),
});

export const updateRuleBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  ruleId: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  interval: syncIntervalSchema.optional(),
  mode: z.enum(["auto", "review"]).optional(),
  watchedTaxonomies: z.array(watchedTaxonomySchema).min(1).max(50).optional(),
});

export const deleteRuleBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  ruleId: z.string().uuid(),
});

export const runRuleBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  ruleId: z.string().uuid(),
});

export const undoBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  activityIds: z.array(z.string().uuid()).min(1).max(200),
});
