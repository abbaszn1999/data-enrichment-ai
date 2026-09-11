import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { 
  projects, 
  lhfInputSheetsData,
  type Project,
  type LHFInputSheetsData,
  type InsertLHFInputSheetsData
} from "@shared/schema";

export class LHFStorage {
  async getLHFProjects(workspaceId: number): Promise<Project[]> {
    const results = await db.select().from(projects).where(
      and(
        eq(projects.toolType, 'low-hanging-fruits'),
        eq(projects.workspaceId, workspaceId)
      )
    );
    return results;
  }

  async getLHFProject(id: number): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(
      and(eq(projects.id, id), eq(projects.toolType, 'low-hanging-fruits'))
    );
    return project || undefined;
  }

  async createLHFProject(name: string, workspaceId: number, userId: number): Promise<Project> {
    const projectData = {
      name,
      toolType: 'low-hanging-fruits' as const,
      workspaceId,
      userId,
      projectName: 'Low Hanging Fruits',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const [project] = await db.insert(projects).values(projectData).returning();

    return project;
  }

  async updateLHFProject(id: number, updates: Partial<Project>): Promise<Project | undefined> {
    const [updatedProject] = await db
      .update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.toolType, 'low-hanging-fruits')))
      .returning();

    return updatedProject || undefined;
  }

  async deleteLHFProject(id: number): Promise<boolean> {
    try {
      const result = await db.delete(projects).where(eq(projects.id, id));
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error('LHF-STORAGE: Error deleting project:', error);
      return false;
    }
  }

  async getLHFProjectData(projectId: number): Promise<any> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async updateLHFProjectData(projectId: number, data: any): Promise<void> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async saveLHFInputSheetsData(data: InsertLHFInputSheetsData): Promise<number> {
    try {
      console.log('LHF-STORAGE: Saving Object Storage metadata with data:', data);
      
      await db.delete(lhfInputSheetsData).where(
        and(
          eq(lhfInputSheetsData.projectId, data.projectId),
          eq(lhfInputSheetsData.sheetType, data.sheetType)
        )
      );

      const [result] = await db.insert(lhfInputSheetsData).values({
        ...data,
        uploadedAt: new Date()
      }).returning();
      
      console.log('LHF-STORAGE: Successfully saved Object Storage metadata with ID:', result.id);
      return result.id;
    } catch (error: any) {
      console.error('LHF-STORAGE: Error saving Object Storage metadata:', error);
      throw new Error(`Failed to save Object Storage metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getLHFInputSheetsData(projectId: number, sheetType: string): Promise<LHFInputSheetsData | null> {
    try {
      const [result] = await db.select().from(lhfInputSheetsData).where(
        and(
          eq(lhfInputSheetsData.projectId, projectId),
          eq(lhfInputSheetsData.sheetType, sheetType)
        )
      );
      return result || null;
    } catch (error: any) {
      console.error('LHF-STORAGE: Error getting Object Storage metadata:', error);
      throw new Error('Failed to get Object Storage metadata');
    }
  }

  async getAllLHFInputSheetsData(projectId: number): Promise<LHFInputSheetsData[]> {
    try {
      const results = await db.select().from(lhfInputSheetsData).where(eq(lhfInputSheetsData.projectId, projectId));
      return results;
    } catch (error: any) {
      console.error('LHF-STORAGE: Error getting all Object Storage metadata:', error);
      throw new Error('Failed to get all Object Storage metadata');
    }
  }

  async getLHFInputSheets(projectId: number): Promise<any[]> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async saveLHFInputSheet(data: any): Promise<number> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async getLHFColumnMappings(projectId: number): Promise<any[]> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async saveLHFColumnMappings(data: any): Promise<void> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async saveLHFGscData(projectId: number, inputSheetId: number, rawData: any[], mappingConfig: Record<string, string>): Promise<void> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async saveLHFProductFeedData(projectId: number, inputSheetId: number, rawData: any[], mappingConfig: Record<string, string>): Promise<void> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async saveLHFPlpFeedData(projectId: number, inputSheetId: number, rawData: any[], mappingConfig: Record<string, string>): Promise<void> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async deleteLHFInputSheet(projectId: number, sheetType: string): Promise<void> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async deleteAllLHFInputSheets(projectId: number): Promise<void> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async getLHFGscData(projectId: number): Promise<any[]> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async getLHFProductFeedData(projectId: number): Promise<any[]> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async getLHFPlpFeedData(projectId: number): Promise<any[]> {
    throw new Error('DEPRECATED: This table no longer exists in the database. Use Object Storage approach instead.');
  }

  async clearLHFProcessingResults(projectId: number): Promise<void> {
    try {
      console.log(`LHF-STORAGE: Cleared processing results for project ${projectId} (Excel files handled by caller)`);
    } catch (error) {
      console.error('LHF-STORAGE: Error clearing processing results:', error);
      throw new Error('Failed to clear processing results');
    }
  }

  async listLHFInputSheetsData(projectId: number): Promise<any[]> {
    try {
      const results = await db.select().from(lhfInputSheetsData).where(
        eq(lhfInputSheetsData.projectId, projectId)
      );
      return results;
    } catch (error) {
      console.error('LHF-STORAGE: Error listing input sheets data:', error);
      throw new Error('Failed to list input sheets data');
    }
  }

  async deleteLHFInputSheetByType(projectId: number, sheetType: string): Promise<void> {
    try {
      await db.delete(lhfInputSheetsData).where(
        and(
          eq(lhfInputSheetsData.projectId, projectId),
          eq(lhfInputSheetsData.sheetType, sheetType)
        )
      );
      console.log(`LHF-STORAGE: Deleted ${sheetType} sheet data for project ${projectId}`);
    } catch (error) {
      console.error('LHF-STORAGE: Error deleting specific sheet data:', error);
      throw new Error('Failed to delete specific sheet data');
    }
  }

  async clearLHFInputSheetsData(projectId: number): Promise<void> {
    try {
      await db.delete(lhfInputSheetsData).where(
        eq(lhfInputSheetsData.projectId, projectId)
      );
      console.log(`LHF-STORAGE: Cleared input sheets data for project ${projectId}`);
    } catch (error) {
      console.error('LHF-STORAGE: Error clearing input sheets data:', error);
      throw new Error('Failed to clear input sheets data');
    }
  }
}
