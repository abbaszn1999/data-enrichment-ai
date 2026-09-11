import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { 
  Play, 
  Square, 
  Download, 
  CheckCircle,
  Clock,
  ArrowLeft,
  ArrowRight,
  Database,
  TrendingUp,
  FileSpreadsheet
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

interface ProcessingPhaseProps {
  projectId: number;
  onComplete: () => void;
  onBackToInput?: () => void;
}

interface ProcessingStatus {
  progress: number;
  status: string;
  logs: string[];
}

export default function LowHangingFruitsProcessingPhase({ projectId, onComplete, onBackToInput }: ProcessingPhaseProps) {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({
    progress: 0,
    status: 'idle',
    logs: []
  });
  const [canDownload, setCanDownload] = useState(false);

  // Check for existing processing status on component mount
  useEffect(() => {
    const checkInitialStatus = async () => {
      try {
        // First check if results exist
        const resultsResponse = await fetch(`/api/lhf-projects/${projectId}/results-exist`, {
          credentials: 'include'
        });
        
        let resultsExist = false;
        if (resultsResponse.ok) {
          const resultsData = await resultsResponse.json();
          resultsExist = resultsData.resultsExist;
        }
        
        // Then check processing status
        const response = await fetch(`/api/lhf-projects/${projectId}/processing-status`, {
          credentials: 'include'
        });
        
        if (response.ok) {
          const status = await response.json();
          console.log('Initial processing status:', status);
          console.log('Results exist:', resultsExist);
          
          // If results exist but status is not completed, override to completed
          let finalStatus = status;
          if (resultsExist && (status.status === 'undefined' || status.status === undefined || status.status === 'idle' || !status.status)) {
            finalStatus = {
              progress: 100,
              status: 'completed',
              logs: ['Processing completed successfully']
            };
            console.log('✅ Overriding status to completed because results exist');
          }
          
          // Ensure logs array exists
          const normalizedStatus = {
            progress: finalStatus.progress || 0,
            status: finalStatus.status || 'idle',
            logs: finalStatus.logs || []
          };
          setProcessingStatus(normalizedStatus);
          
          if (finalStatus.status === 'completed') {
            setCanDownload(true);
            console.log('✅ Found completed processing on mount');
          } else if (finalStatus.status === 'processing') {
            setIsProcessing(true);
            console.log('🔄 Found active processing on mount');
          }
        }
      } catch (error) {
        console.error('Error checking initial status:', error);
      }
    };

    checkInitialStatus();
  }, [projectId]);

  // Poll for processing status
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isProcessing) {
      interval = setInterval(async () => {
        try {
          const response = await fetch(`/api/lhf-projects/${projectId}/processing-status`, {
            credentials: 'include'
          });
          
          if (response.ok) {
            const status = await response.json();
            // Ensure logs array exists
            const normalizedStatus = {
              progress: status.progress || 0,
              status: status.status || 'idle',
              logs: status.logs || []
            };
            setProcessingStatus(normalizedStatus);
            
            if (status.status === 'completed') {
              setIsProcessing(false);
              setCanDownload(true);
              onComplete();
              toast({
                title: "Processing Complete!",
                description: "Low hanging fruits analysis has been completed successfully."
              });
            } else if (status.status === 'failed') {
              setIsProcessing(false);
              toast({
                title: "Processing Failed",
                description: "There was an error during processing. Please try again.",
                variant: "destructive"
              });
            }
          }
        } catch (error) {
          console.error('Error polling status:', error);
        }
      }, 2000); // Poll every 2 seconds
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isProcessing, projectId, onComplete, toast]);

  const startProcessing = async () => {
    try {
      setIsProcessing(true);
      setProcessingStatus({ progress: 0, status: 'starting', logs: [] });
      
      const response = await apiRequest('POST', `/api/lhf-projects/${projectId}/start-processing`, {});
      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "Processing Started",
          description: "Low hanging fruits analysis has begun."
        });
      } else {
        throw new Error(result.message || 'Failed to start processing');
      }
    } catch (error) {
      setIsProcessing(false);
      toast({
        title: "Error Starting Processing",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive"
      });
    }
  };

  const stopProcessing = async () => {
    try {
      const response = await apiRequest('POST', `/api/lhf-projects/${projectId}/stop-processing`, {});
      const result = await response.json();
      setIsProcessing(false);
      toast({
        title: "Processing Stopped",
        description: "Processing has been stopped."
      });
    } catch (error) {
      toast({
        title: "Error Stopping Processing",
        description: "Failed to stop processing",
        variant: "destructive"
      });
    }
  };

  const downloadResults = () => {
    const downloadUrl = `/api/lhf-projects/${projectId}/download-excel`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `Low_Hanging_Fruits_Results_${projectId}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({
      title: "Download Started",
      description: "Your results file is being downloaded."
    });
  };

  const getStatusColor = () => {
    switch (processingStatus.status) {
      case 'completed': return 'text-green-600';
      case 'failed': return 'text-red-600';
      case 'processing': return 'text-blue-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusText = () => {
    if (isProcessing) {
      return processingStatus.status === 'starting' ? 'Starting...' : processingStatus.status;
    }
    return processingStatus.status === 'completed' ? 'Completed' : 'Ready to start';
  };

  // Phase definitions for Low Hanging Fruits workflow
  const phases = [
    {
      id: 'phase1',
      name: 'Data Loading & Analysis',
      description: 'Loading GSC data, Product feeds, and PLP feeds for comprehensive analysis',
      icon: Database,
      color: 'bg-blue-500'
    },
    {
      id: 'phase2', 
      name: 'Opportunity Identification',
      description: 'Analyzing search performance metrics to identify low hanging fruit opportunities',
      icon: TrendingUp,
      color: 'bg-purple-500'
    },
    {
      id: 'phase3',
      name: 'Results Generation',
      description: 'Generating product and category opportunity recommendations with actionable insights',
      icon: FileSpreadsheet,
      color: 'bg-green-500'
    }
  ];

  // Helper function to determine phase status based on progress
  const getPhaseStatus = (phaseIndex: number) => {
    const progressThresholds = [30, 70, 100];
    const currentProgress = processingStatus.progress;
    
    if (processingStatus.status === 'completed') {
      return 'completed';
    }
    
    if (currentProgress >= progressThresholds[phaseIndex]) {
      return 'completed';
    } else if (phaseIndex === 0 && currentProgress > 0) {
      return 'active';
    } else if (phaseIndex === 1 && currentProgress > 30) {
      return 'active';
    } else if (phaseIndex === 2 && currentProgress > 70) {
      return 'active';
    }
    
    return 'pending';
  };

  return (
    <div className="space-y-6">
      {/* Processing Control Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Low Hanging Fruits Processing</CardTitle>
              <CardDescription>
                AI-powered analysis to identify SEO opportunities from your data
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {onBackToInput && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onBackToInput}
                  className="flex items-center gap-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Input
                </Button>
              )}
              {processingStatus.status === 'completed' && (
                <Badge variant="default" className="bg-green-500">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Processing Complete
                </Badge>
              )}
              {canDownload && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadResults}
                  className="flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download Results
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Processing Phases */}
      <div className="grid gap-4">
        <h3 className="text-lg font-medium">Processing Phases</h3>
        
        {phases.map((phase, index) => {
          const Icon = phase.icon;
          const phaseStatus = getPhaseStatus(index);
          const isCompleted = phaseStatus === 'completed';
          const isActive = phaseStatus === 'active';
          const isPending = phaseStatus === 'pending';
          
          return (
            <Card key={phase.id} className={`transition-all duration-300 ${
              isActive ? 'ring-2 ring-blue-500 bg-blue-50' :
              isCompleted ? 'bg-green-50 border-green-200' :
              'bg-gray-50'
            }`}>
              <CardContent className="flex items-center gap-4 p-6">
                <div className={`p-3 rounded-full ${
                  isCompleted ? 'bg-green-500' :
                  isActive ? 'bg-blue-500' :
                  phase.color
                } text-white`}>
                  <Icon className="h-6 w-6" />
                </div>
                
                <div className="flex-1">
                  <h4 className="font-medium">{phase.name}</h4>
                  <p className="text-sm text-gray-600 mt-1">{phase.description}</p>
                  {isActive && (
                    <div className="mt-2">
                      <Progress value={processingStatus.progress} className="h-2" />
                      <p className="text-xs text-gray-500 mt-1">
                        {processingStatus.logs.length > 0 ? processingStatus.logs[processingStatus.logs.length - 1] : 'Processing...'}
                      </p>
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-gray-600">
                    Phase {index + 1}
                  </Badge>
                  {isCompleted && (
                    <Badge variant="default" className="bg-green-100 text-green-800">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Completed
                    </Badge>
                  )}
                  {isActive && (
                    <Badge variant="default" className="bg-blue-100 text-blue-800">
                      <Clock className="h-3 w-3 mr-1" />
                      Processing
                    </Badge>
                  )}
                  {isPending && (
                    <Badge variant="outline" className="bg-gray-100 text-gray-600">
                      <Clock className="h-3 w-3 mr-1" />
                      Pending
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Processing Controls */}
      {processingStatus.status === 'completed' ? (
        // Processing Complete Card
        <Card className="border-2 border-green-200 bg-green-50">
          <CardContent className="p-8 text-center">
            <div className="flex flex-col items-center space-y-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-green-800 mb-2">
                  Processing Complete!
                </h3>
                <p className="text-green-700 mb-4">
                  Your Low Hanging Fruits analysis is ready for review
                </p>
                <Button 
                  onClick={onComplete}
                  className="bg-green-600 hover:bg-green-700 text-white px-8 py-2"
                  size="lg"
                >
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Go to Results
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex justify-center gap-4">
          {isProcessing ? (
            <Button onClick={stopProcessing} variant="outline" size="lg">
              <Square className="w-4 h-4 mr-2" />
              Stop Processing
            </Button>
          ) : (
            <Button onClick={startProcessing} size="lg">
              <Play className="w-4 h-4 mr-2" />
              Start Processing
            </Button>
          )}
        </div>
      )}

      {/* Processing Log */}
      {processingStatus.logs && processingStatus.logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Processing Log</CardTitle>
            <CardDescription>
              Real-time processing status and progress updates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-50 rounded-lg p-4 max-h-64 overflow-y-auto">
              <div className="space-y-1 font-mono text-sm">
                {processingStatus.logs.map((log, index) => (
                  <div key={index} className="text-gray-700">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Processing Algorithm Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Processing Overview</CardTitle>
          <CardDescription>
            Understanding the Low Hanging Fruits analysis workflow
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-blue-600 font-semibold text-xs">1</span>
              </div>
              <div>
                <strong>Data Loading & Analysis:</strong> Loads GSC data, Product feeds, and PLP feeds for comprehensive analysis
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-purple-600 font-semibold text-xs">2</span>
              </div>
              <div>
                <strong>Opportunity Identification:</strong> Analyzes search performance metrics to identify low hanging fruit opportunities
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-green-600 font-semibold text-xs">3</span>
              </div>
              <div>
                <strong>Results Generation:</strong> Creates comprehensive analysis report with actionable low hanging fruit recommendations
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}