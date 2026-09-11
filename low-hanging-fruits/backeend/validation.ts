import { z } from 'zod';
import { lowHangingFruitsInsertSchema } from './types';

export const validateCreateLowHangingFruitsProject = (data: unknown) => {
  const schema = lowHangingFruitsInsertSchema.extend({
    toolType: z.literal('low-hanging-fruits').default('low-hanging-fruits')
  });
  
  return schema.parse(data);
};

export const validateProjectId = (id: string) => {
  const parsedId = parseInt(id);
  if (isNaN(parsedId) || parsedId <= 0) {
    throw new Error("Invalid project ID");
  }
  return parsedId;
};

export const validateWorkspaceAccess = async (
  workspaceId: number, 
  userId: number, 
  storage: any
) => {
  const workspace = await storage.getWorkspace(workspaceId, userId);
  if (!workspace) {
    throw new Error("Workspace not found or access denied");
  }
  return workspace;
};