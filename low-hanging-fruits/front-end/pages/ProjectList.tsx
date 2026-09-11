import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, TrendingUp, BarChart3, Search, ChevronRight } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/utils";
import { Link } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface LHFProject {
  id: number;
  name: string;
  workspaceId: number;
  createdAt: string;
  updatedAt: string;
}

export default function LowHangingFruits() {
  const [projectName, setProjectName] = useState("");
  const [projectToDelete, setProjectToDelete] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get current workspace data
  const { data: currentWorkspace } = useQuery({
    queryKey: ['/api/workspaces/current'],
  });

  const workspace = currentWorkspace?.workspace;
  const workspaceName = workspace?.name || "No Workspace Selected";
  
  // Get LHF projects for current workspace
  const { data: projects = [], isLoading } = useQuery<LHFProject[]>({
    queryKey: ['/api/lhf-projects', workspace?.id],
    enabled: !!workspace?.id,
  });

  // Create project mutation
  const createProjectMutation = useMutation({
    mutationFn: async (projectName: string) => {
      if (!workspace?.id) {
        throw new Error("Current workspace is not identified. Please refresh or select a workspace.");
      }
      
      const response = await fetch('/api/lhf-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: projectName,
          workspaceId: workspace.id
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to create project');
      }
      
      return await response.json();
    },
    onSuccess: () => {
      setProjectName("");
      queryClient.invalidateQueries({ queryKey: ['/api/lhf-projects', workspace?.id] });
      toast({
        title: "Project created",
        description: "Your Low Hanging Fruits project has been created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error creating project",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Delete project mutation
  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId: number) => {
      const response = await fetch(`/api/lhf-projects/${projectId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete project');
      }
      
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/lhf-projects', workspace?.id] });
      setProjectToDelete(null);
      toast({
        title: "Project deleted",
        description: "The project has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting project",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) {
      toast({
        title: "Project name required",
        description: "Please enter a name for your project.",
        variant: "destructive",
      });
      return;
    }
    createProjectMutation.mutate(projectName.trim());
  };

  const handleDeleteProject = (id: number) => {
    deleteProjectMutation.mutate(id);
  };

  const formatProjectDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto px-6 py-8">
        {/* Header Section */}
        <div className="text-center mb-12">
          <div className="flex justify-center items-center mb-6">
            <div className="bg-blue-600 p-4 rounded-2xl shadow-lg">
              <TrendingUp className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Low Hanging Fruits</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            AI-powered quick wins identification platform
          </p>
          <p className="text-gray-500 mt-2 max-w-3xl mx-auto">
            Identify quick wins for SEO improvements based on your existing product and category pages through intelligent data analysis
          </p>
        </div>

        {/* Feature Highlights */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card className="border-blue-100 hover:border-blue-200 transition-colors">
            <CardHeader className="text-center pb-2">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="h-6 w-6 text-blue-600" />
              </div>
              <CardTitle className="text-lg">Smart Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                Analyze your existing pages using AI to identify immediate SEO improvement opportunities
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-blue-100 hover:border-blue-200 transition-colors">
            <CardHeader className="text-center pb-2">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <BarChart3 className="h-6 w-6 text-blue-600" />
              </div>
              <CardTitle className="text-lg">Performance Insights</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                Leverage data analysis to identify high-impact, low-effort improvements for maximum ROI
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-blue-100 hover:border-blue-200 transition-colors">
            <CardHeader className="text-center pb-2">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="h-6 w-6 text-blue-600" />
              </div>
              <CardTitle className="text-lg">Quick Wins</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                Automatically prioritize and implement easy-to-execute improvements that deliver fast results
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        {/* Create New Project Section */}
        <Card className="mb-8 border-2 border-dashed border-gray-200 hover:border-blue-300 transition-colors">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Plus className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-xl">Create New Project</CardTitle>
                <CardDescription>
                  Start a new Low Hanging Fruits project in <span className="font-medium text-blue-600">{workspaceName}</span>
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateProject} className="flex gap-4">
              <Input
                id="lhfProjectNameInput"
                type="text"
                placeholder="Enter project name (e.g., Q4 Quick Wins Analysis)"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="flex-1"
              />
              <Button 
                id="createLHFProjectBtn"
                type="submit"
                disabled={createProjectMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 px-6"
              >
                {createProjectMutation.isPending ? "Creating..." : "Create Project"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Your Projects */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Your Projects</h2>
          <p className="text-gray-600 mb-6">Manage and access your Low Hanging Fruits projects</p>
          
          {isLoading ? (
            <Card>
              <CardContent className="text-center py-12">
                <div className="animate-pulse space-y-4">
                  <div className="h-8 bg-gray-200 rounded w-1/3 mx-auto"></div>
                  <div className="h-32 bg-gray-200 rounded"></div>
                  <div className="h-24 bg-gray-200 rounded"></div>
                </div>
              </CardContent>
            </Card>
          ) : projects.length === 0 ? (
            <Card className="border-dashed border-gray-300">
              <CardContent className="text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <TrendingUp className="h-8 w-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
                <p className="text-gray-500 mb-4">Create your first Low Hanging Fruits project to get started</p>
                <Button 
                  onClick={() => document.querySelector('#lhfProjectNameInput')?.focus()}
                  variant="outline"
                  className="border-blue-200 text-blue-600 hover:bg-blue-50"
                >
                  Create Your First Project
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {projects.map((project) => (
                <Card key={project.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                          <TrendingUp className="h-6 w-6 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">{project.name}</h3>
                          <p className="text-sm text-gray-500">
                            Created {formatProjectDate(project.createdAt)} • Low Hanging Fruits
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Link href={`/lhf-project/${project.id}`}>
                          <Button 
                            id={`openProjectBtn-${project.id}`}
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            Open Project
                            <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                        </Link>
                        
                        <AlertDialog open={projectToDelete === project.id} onOpenChange={(open) => !open && setProjectToDelete(null)}>
                          <AlertDialogTrigger asChild>
                            <Button 
                              id={`deleteProjectBtn-${project.id}`}
                              variant="outline" 
                              size="icon" 
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => setProjectToDelete(project.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Project</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete "{project.name}"? This action cannot be undone and will remove all project data.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => handleDeleteProject(project.id)}
                                className="bg-red-600 hover:bg-red-700"
                              >
                                Delete Project
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}