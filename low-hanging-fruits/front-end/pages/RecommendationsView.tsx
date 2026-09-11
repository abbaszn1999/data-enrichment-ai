import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, X, CheckCircle, Settings, Play, Trash2, Save, TrendingUp } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LHFResultsHeader } from '../components/LHFResultsHeader';

import InputPhase from "../components/InputPhase";
import ProcessingPhase from "../components/ProcessingPhase";

export default function LowHangingFruitsProject() {
  const params = useParams();
  const projectId = parseInt(params.id as string);
  const projectName = "tet"; // Mock project name
  const { toast } = useToast();
  
  const [activeStep, setActiveStep] = useState(1);
  
  // Input phase completion state
  const [inputPhaseComplete, setInputPhaseComplete] = useState(false);
  
  // Save to Feeds dialog state
  const [showSaveToFeedsDialog, setShowSaveToFeedsDialog] = useState(false);
  const [feedName, setFeedName] = useState("");
  const [saveProducts, setSaveProducts] = useState(true);
  const [saveCategories, setSaveCategories] = useState(true);
  const [productsType, setProductsType] = useState("Product Feed");
  const [categoriesType, setCategoriesType] = useState("Product Listing Page");
  
  // Check if results already exist for this project
  const { data: resultsData, isLoading: isLoadingResults } = useQuery({
    queryKey: [`/api/lhf-projects/${projectId}/results-exist`],
    enabled: !!projectId
  });

  // Check if input sheets exist  
  const { data: inputSheetsResponse, isLoading: isLoadingSheets } = useQuery({
    queryKey: [`/api/lhf-projects/${projectId}/input-sheets`],
    enabled: !!projectId
  });
  
  const inputSheetsData = (inputSheetsResponse as any)?.data || [];
  
  // Auto-navigate to appropriate phase based on existing data
  useEffect(() => {
    if (isLoadingResults || isLoadingSheets) return;
    
    // Only update input completion status, don't auto-navigate between phases
    if (inputSheetsData && Array.isArray(inputSheetsData)) {
      const hasGscData = inputSheetsData.some(sheet => sheet.sheetType === 'gsc_data');
      const hasProductFeed = inputSheetsData.some(sheet => sheet.sheetType === 'product_feed');
      const hasPlpFeed = inputSheetsData.some(sheet => sheet.sheetType === 'plp_feed');
      
      if (hasGscData && hasProductFeed && hasPlpFeed) {
        setInputPhaseComplete(true);
      } else {
        setInputPhaseComplete(false);
      }
    }
  }, [resultsData, inputSheetsData, isLoadingResults, isLoadingSheets]);

  // State restoration: Check project status on mount to navigate to results if completed
  useEffect(() => {
    const checkProjectPhase = async () => {
      try {
        // Fetch project status from processing-status endpoint
        const response = await fetch(`/api/lhf-projects/${projectId}/processing-status`);
        if (response.ok) {
          const statusData = await response.json();
          
          console.log('🔍 [LHF] Project status check:', statusData);
          
          // Check multiple status indicators:
          // - status: 'completed' (when results exist in Object Storage)
          // - phaseStatus: 'completed' (when results exist in Object Storage)
          // - databaseStatus: 'completed' (when checking database)
          // - isComplete: true (when results exist in Object Storage)
          if (statusData.status === 'completed' || 
              statusData.phaseStatus === 'completed' || 
              statusData.databaseStatus === 'completed' ||
              statusData.isComplete === true) {
            console.log('✅ [LHF] Completed project detected, switching to results phase');
            setActiveStep(3); // Results is step 3
          }
          // Otherwise stay at current phase (default)
        }
      } catch (error) {
        console.error('Error checking project phase on mount:', error);
      }
    };

    if (projectId) {
      checkProjectPhase();
    }
  }, [projectId]);

  // Excel download functionality
  const downloadExcelResults = () => {
    const downloadUrl = `/api/lhf-projects/${projectId}/download-excel`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `Low_Hanging_Fruits_Results_${projectId}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({
      title: "Download Started",
      description: "Your Low Hanging Fruits results file is being downloaded."
    });
  };

  // Clear results mutation
  const clearResultsMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', `/api/lhf-projects/${projectId}/clear-results`),
    onSuccess: () => {
      // Invalidate results queries to refresh data
      queryClient.invalidateQueries({ queryKey: [`/api/lhf-projects/${projectId}/results-exist`] });
      queryClient.invalidateQueries({ queryKey: [`/api/lhf-projects/${projectId}/input-sheets`] });
      
      // Navigate back to Input phase
      setActiveStep(1);
      setInputPhaseComplete(false);
      
      toast({
        title: "Success",
        description: "All results cleared successfully",
        variant: "default"
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to clear results",
        variant: "destructive"
      });
    }
  });

  // Save to feeds mutation
  const saveToFeedsMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', `/api/lhf-projects/${projectId}/save-to-feeds`, data),
    onSuccess: (response) => {
      setShowSaveToFeedsDialog(false);
      // Reset form
      setFeedName("");
      setSaveProducts(true);
      setSaveCategories(true);
      setProductsType("Product Feed");
      setCategoriesType("Product Listing Page");
      
      toast({
        title: "Success",
        description: (response as any).message || `Successfully created ${(response as any).feeds?.length || 0} feed(s)`,
        variant: "default"
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save to feeds",
        variant: "destructive"
      });
    }
  });

  // Handle save to feeds
  const handleSaveToFeeds = () => {
    if (!feedName.trim()) {
      toast({
        title: "Feed name required",
        description: "Please enter a name for your feed.",
        variant: "destructive",
      });
      return;
    }

    if (!saveProducts && !saveCategories) {
      toast({
        title: "Select output type",
        description: "Please select at least one output type to save.",
        variant: "destructive",
      });
      return;
    }

    saveToFeedsMutation.mutate({
      feedName: feedName.trim(),
      saveProducts,
      saveCategories,
      productsType,
      categoriesType
    });
  };



  const phases = [
    { 
      id: 1, 
      name: "Input Feed", 
      description: "Upload and map your input data sheets", 
      icon: "upload",
      status: activeStep === 1 ? "in-progress" : (inputPhaseComplete ? "completed" : "pending"),
      active: activeStep === 1 
    },
    { 
      id: 2, 
      name: "Processing Phase", 
      description: "Analyze data and identify opportunities", 
      icon: "play",
      status: activeStep === 2 ? "in-progress" : ((resultsData as any)?.exists || activeStep > 2) ? "completed" : (inputPhaseComplete ? "pending" : "disabled"),
      active: activeStep === 2 
    },
    { 
      id: 3, 
      name: "Results", 
      description: "View recommendations and export data", 
      icon: "settings",
      status: activeStep === 3 ? "in-progress" : ((resultsData as any)?.exists ? "completed" : "pending"),
      active: activeStep === 3 
    }
  ];







  // Show loading state while detecting project status
  if (isLoadingResults || isLoadingSheets) {
    return (
      <div className="max-w-6xl">
        <div className="mb-6">
          <Link href="/low-hanging-fruits" className="text-secondary hover:text-secondary/80 text-sm flex items-center mb-4">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Low-Hanging Fruits Projects
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">
            Low Hanging Fruits Project: {projectName}
          </h1>
        </div>
        
        <Card>
          <CardContent className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-secondary mx-auto mb-4"></div>
            <p className="text-gray-600">Detecting project status...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link href="/low-hanging-fruits">
            <Button variant="ghost" className="mb-4 text-blue-600 hover:text-blue-700 hover:bg-blue-50">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Low-Hanging Fruits Projects
            </Button>
          </Link>
          
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 bg-orange-500 rounded-2xl shadow-lg flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Low Hanging Fruits Project</h1>
              <p className="text-gray-600">{projectName}</p>
            </div>
          </div>
          
          {/* Status indicator */}
          {(resultsData as any)?.exists && (
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              ✓ Results Available
            </Badge>
          )}
        </div>

        {/* Phase Navigation - Matching Link Boosting Style */}
        <div className="flex items-center justify-center space-x-12 mb-12">
          {phases.map((phase) => {
            const isActive = phase.status === 'in-progress';
            const isCompleted = phase.status === 'completed';
            const isPending = phase.status === 'pending';
            
            // Icon component
            const IconComponent = phase.icon === 'upload' ? Upload : phase.icon === 'settings' ? Settings : Play;
            
            // Define colors based on phase
            const getPhaseColors = () => {
              if (isActive) {
                return {
                  bgColor: phase.id === 1 ? 'bg-blue-500' : phase.id === 2 ? 'bg-purple-500' : 'bg-green-500',
                  textColor: phase.id === 1 ? 'text-blue-600' : phase.id === 2 ? 'text-purple-600' : 'text-green-600'
                };
              }
              return {
                bgColor: isCompleted ? 'bg-gray-300' : 'bg-gray-200',
                textColor: isCompleted ? 'text-gray-600' : 'text-gray-400'
              };
            };
            
            const colors = getPhaseColors();
            
            return (
              <div key={phase.id} className="flex flex-col items-center">
                <button
                  onClick={() => {
                    // Allow navigation to any phase except disabled ones
                    if (phase.status !== 'disabled') {
                      setActiveStep(phase.id);
                    }
                  }}
                  className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 transition-colors duration-200 ${
                    isActive
                      ? `${colors.bgColor} text-white`
                      : isCompleted
                      ? 'bg-gray-300 text-gray-600'
                      : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                  }`}
                  disabled={phase.status === 'disabled'}
                >
                  <IconComponent className="h-5 w-5" />
                </button>
                <span className={`text-sm font-medium ${
                  isActive ? colors.textColor : isCompleted ? 'text-gray-600' : 'text-gray-400'
                }`}>
                  {phase.name}
                </span>
              </div>
            );
          })}
        </div>

        {/* Current Phase Content */}
        <div className="max-w-6xl mx-auto">
          <div>
            {/* Step 1: Input & Configuration */}
            {activeStep === 1 && (
              <InputPhase 
                projectId={projectId} 
                onComplete={() => {
                  // Don't auto-advance to processing - let user choose when to proceed
                  setInputPhaseComplete(true);
                }}
                onStatusChange={(completed) => {
                  setInputPhaseComplete(completed);
                }}
                onNavigateToProcessing={() => {
                  // Navigate to processing phase when button is clicked
                  setActiveStep(2);
                }}
              />
            )}

            {/* Step 2: Processing */}
            {activeStep === 2 && (
              <ProcessingPhase 
                projectId={projectId} 
                onComplete={() => {
                  // Navigate to results when user clicks "Go to Results" button
                  setActiveStep(3);
                  queryClient.invalidateQueries({ queryKey: [`/api/lhf-projects/${projectId}/results-exist`] });
                }}
                onBackToInput={() => {
                  setActiveStep(1);
                }}
              />
            )}

            {/* Step 3: Results */}
            {activeStep === 3 && (
              <div className="space-y-6">
                {/* Specialized Low Hanging Fruits Results Header with Separate Sheet Upload */}
                <LHFResultsHeader
                  projectId={projectId}
                  downloadEndpoint={`/api/lhf-projects/${projectId}/download-excel`}
                  description="Your Low Hanging Fruits analysis has been completed successfully."
                >
                  {/* Results Summary */}
                  <div className="space-y-3 mb-4">
                    <div className="flex items-center gap-3 text-left bg-green-50 p-3 rounded-lg border-l-4 border-green-500">
                      <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
                      <div>
                        <span className="font-medium text-gray-900">Products Output</span>
                        <span className="text-gray-600 text-sm"> - Product opportunities with SEO metrics</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-left bg-blue-50 p-3 rounded-lg border-l-4 border-blue-500">
                      <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></div>
                      <div>
                        <span className="font-medium text-gray-900">Category Output</span>
                        <span className="text-gray-600 text-sm"> - Category opportunities with keyword analysis</span>
                      </div>
                    </div>
                  </div>
                </LHFResultsHeader>

                {/* Clear Results Button */}
                <div className="flex justify-center pt-4">
                  <Button 
                    variant="destructive"
                    onClick={() => clearResultsMutation.mutate()}
                    disabled={clearResultsMutation.isPending}
                    className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg font-medium flex items-center gap-2"
                  >
                    {clearResultsMutation.isPending ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Clearing...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4" />
                        Clear Results
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Save to Feeds Dialog */}
      <Dialog open={showSaveToFeedsDialog} onOpenChange={setShowSaveToFeedsDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save to Feeds</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="feedName">Feed Name</Label>
              <Input
                id="feedName"
                value={feedName}
                onChange={(e) => setFeedName(e.target.value)}
                placeholder="Enter feed name"
                className="mt-1"
              />
            </div>
            
            <div className="space-y-3">
              <Label>Output Sheets to Save</Label>
              
              <div className="space-y-3">
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="saveProducts"
                    checked={saveProducts}
                    onCheckedChange={(checked) => setSaveProducts(!!checked)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <Label htmlFor="saveProducts" className="text-sm font-medium">
                      Save Products Output
                    </Label>
                    <p className="text-xs text-gray-500 mt-1">
                      Products_Output_Completed sheet with SEO metrics
                    </p>
                    {saveProducts && (
                      <div className="mt-2">
                        <Label className="text-xs">Feed Type</Label>
                        <Select value={productsType} onValueChange={setProductsType}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Product Feed">Product Feed</SelectItem>
                            <SelectItem value="General Feed">General Feed</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="saveCategories"
                    checked={saveCategories}
                    onCheckedChange={(checked) => setSaveCategories(!!checked)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <Label htmlFor="saveCategories" className="text-sm font-medium">
                      Save Categories Output
                    </Label>
                    <p className="text-xs text-gray-500 mt-1">
                      Categ_Output_Completed sheet with keyword analysis
                    </p>
                    {saveCategories && (
                      <div className="mt-2">
                        <Label className="text-xs">Feed Type</Label>
                        <Select value={categoriesType} onValueChange={setCategoriesType}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Product Listing Page">Product Listing Page</SelectItem>
                            <SelectItem value="General Feed">General Feed</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end gap-2 pt-4">
              <Button 
                variant="outline" 
                onClick={() => setShowSaveToFeedsDialog(false)}
                disabled={saveToFeedsMutation.isPending}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSaveToFeeds}
                disabled={!feedName.trim() || (!saveProducts && !saveCategories) || saveToFeedsMutation.isPending}
                className="bg-secondary hover:bg-secondary/90"
              >
                {saveToFeedsMutation.isPending ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Feed{(saveProducts && saveCategories) ? 's' : ''}
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}