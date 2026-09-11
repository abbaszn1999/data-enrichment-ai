// Low Hanging Fruits module types
export interface LowHangingFruitsProject {
  id: string;
  name: string;
  workspaceId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}