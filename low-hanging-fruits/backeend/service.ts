import { IStorage } from '../../storage';
import { 
  LowHangingFruitsInsert, 
  LowHangingFruitsSelect,
  CreateLowHangingFruitsProjectRequest 
} from './types';
import { 
  validateCreateLowHangingFruitsProject, 
  validateProjectId, 
  validateWorkspaceAccess 
} from './validation';

export class LowHangingFruitsService {
  constructor(private storage: IStorage) {}

  async getProjects(workspaceId: number, userId: number): Promise<LowHangingFruitsSelect[]> {
    await validateWorkspaceAccess(workspaceId, userId, this.storage);
    return this.storage.getToolProjects('low-hanging-fruits', workspaceId);
  }

  async createProject(
    data: CreateLowHangingFruitsProjectRequest, 
    userId: number
  ): Promise<LowHangingFruitsSelect> {
    await validateWorkspaceAccess(data.workspaceId, userId, this.storage);
    
    const validatedData = validateCreateLowHangingFruitsProject({
      ...data,
      toolType: 'low-hanging-fruits'
    });

    return this.storage.createToolProject(
      'low-hanging-fruits',
      validatedData.name,
      validatedData.workspaceId,
      userId
    );
  }

  async deleteProject(projectId: string, userId: number): Promise<boolean> {
    const id = validateProjectId(projectId);
    return this.storage.deleteToolProject(id, 'low-hanging-fruits');
  }

  async getProject(projectId: string): Promise<LowHangingFruitsSelect | null> {
    const id = validateProjectId(projectId);
    const projects = await this.storage.getToolProjects('low-hanging-fruits', 0);
    return projects.find(p => p.id === id) || null;
  }
}