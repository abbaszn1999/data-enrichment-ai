import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Download, Upload, CheckCircle } from 'lucide-react';
import { FeedUploader } from '@/components/FeedUploader';

interface LHFResultsHeaderProps {
  projectId: number;
  downloadEndpoint: string;
  description?: string;
  children?: React.ReactNode;
}

export function LHFResultsHeader({
  projectId,
  downloadEndpoint,
  description,
  children
}: LHFResultsHeaderProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(downloadEndpoint, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to download file');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `Low_Hanging_Fruits_Results_${projectId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading file:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Badge variant="default" className="bg-green-500">
                <CheckCircle className="h-3 w-3 mr-1" />
                Complete
              </Badge>
              <CardTitle>Low Hanging Fruits Analysis Complete</CardTitle>
            </div>
            {description && (
              <p className="text-gray-600 mt-2">{description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={isDownloading}
            >
              <Download className="h-4 w-4 mr-2" />
              {isDownloading ? 'Downloading...' : 'Download Complete Results'}
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        {children}
        
        {/* Separate Feed Upload Options */}
        <div className="mt-6 space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Save Results to Feeds</h3>
          <p className="text-sm text-gray-600">
            Save each analysis sheet as a separate feed for reuse in other AI tools.
          </p>
          
          <div className="grid gap-4 md:grid-cols-2">
            {/* Products Feed Upload */}
            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="font-medium text-gray-900">Products Analysis</h4>
                  <p className="text-sm text-gray-600">Product opportunities with SEO metrics</p>
                </div>
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              </div>
              <FeedUploader
                toolName="Low Hanging Fruits Products"
                projectId={projectId}
                downloadEndpoint={downloadEndpoint}
                suggestedFeedType="product"
                sheetName="Products_Output_Completed"
                size="sm"
                buttonClassName="w-full border-purple-200 text-purple-700 hover:bg-purple-50"
              >
                <Upload className="h-4 w-4 mr-2" />
                Save Products to Feed
              </FeedUploader>
            </div>

            {/* Categories Feed Upload */}
            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="font-medium text-gray-900">Categories Analysis</h4>
                  <p className="text-sm text-gray-600">Category opportunities with SEO metrics</p>
                </div>
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              </div>
              <FeedUploader
                toolName="Low Hanging Fruits Categories"
                projectId={projectId}
                downloadEndpoint={downloadEndpoint}
                suggestedFeedType="product_listing_page"
                sheetName="Categ_Output_Completed"
                size="sm"
                buttonClassName="w-full border-purple-200 text-purple-700 hover:bg-purple-50"
              >
                <Upload className="h-4 w-4 mr-2" />
                Save Categories to Feed
              </FeedUploader>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}