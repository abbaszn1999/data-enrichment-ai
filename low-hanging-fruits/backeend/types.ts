import { z } from 'zod';
import { createInsertSchema } from 'drizzle-zod';
import { projects } from '../../../shared/schema';

export const lowHangingFruitsInsertSchema = createInsertSchema(projects, {
  name: z.string().min(1, "Project name is required"),
  toolType: z.literal('low-hanging-fruits'),
  workspaceId: z.number().positive("Valid workspace ID is required")
}).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export type LowHangingFruitsInsert = z.infer<typeof lowHangingFruitsInsertSchema>;
export type LowHangingFruitsSelect = typeof projects.$inferSelect;

export interface CreateLowHangingFruitsProjectRequest {
  name: string;
  workspaceId: number;
}

export interface LowHangingFruitsProjectResponse extends LowHangingFruitsSelect {}