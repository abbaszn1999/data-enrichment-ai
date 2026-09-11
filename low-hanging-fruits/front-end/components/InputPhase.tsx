import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Upload, CheckCircle, ArrowRight, Trash2, FileSpreadsheet, Database, ArrowLeft, AlertCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useQuery } from '@tanstack/react-query';
import { FeedSelector } from '@/components/FeedSelector';
import * as XLSX from 'xlsx';

interface InputPhaseProps {
  projectId: number;
  onComplete: () => void;
  onStatusChange?: (completed: boolean) => void;
  onNavigateToProcessing?: () => void;
}

interface FileUploadState {
  file: File | null;
  headers: string[];
  data: any[];
  isProcessing: boolean;
  error: string | null;
  step: 'upload' | 'mapping' | 'complete';
  columnMappings: Record<string, string>;
  hasExistingData?: boolean;
  feedData?: {
    feedId: number;
    feedName: string;
    feedType: string;
    totalRows: number;
  };
}

type InputSheetType = 'gsc_data' | 'product_feed' | 'plp_feed';

// Helper function to download existing Excel file from feed Object Storage
const downloadFeedExcelFile = async (feedId: number, feedName: string): Promise<File> => {
  // Download the actual Excel file from Object Storage
  const response = await fetch(`/api/feeds/${feedId}/download`);
  
  if (!response.ok) {
    throw new Error('Failed to download feed file');
  }
  
  const blob = await response.blob();
  return new File([blob], `${feedName}_feed.xlsx`, { 
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
  });
};

const INPUT_SHEET_CONFIGS = {
  gsc_data: {
    title: 'GSC Data Upload',
    description: 'Upload your Google Search Console data with query performance metrics.',
    requiredColumns: ['Query', 'Clicks', 'Impressions', 'CTR', 'Position'],
    color: 'blue'
  },
  product_feed: {
    title: 'Product Feed Upload', 
    description: 'Upload your product data feed with product information.',
    requiredColumns: ['Name', 'URL Slug', 'Record ID'],
    color: 'green'
  },
  plp_feed: {
    title: 'PLP Feed Upload',
    description: 'Upload your Product Listing Page data.',
    requiredColumns: ['Name', 'URL Slug', 'Page Type'],
    color: 'purple'
  }
};

// GSC Data Mapping Component
function GscDataMapping({ headers, onSave, isProcessing }: { headers: string[]; onSave: (mappings: Record<string, string>) => void; isProcessing: boolean }) {
  const [mappings, setMappings] = useState<Record<string, string>>({
    query: '', page: '', clicks: '', impressions: '', ctr: '', position: ''
  });

  const requiredFields = ['query', 'clicks', 'impressions', 'ctr', 'position'];
  const allRequiredMapped = requiredFields.every(field => mappings[field]);
  const mappedCount = requiredFields.filter(field => mappings[field]).length;
  const remainingCount = requiredFields.length - mappedCount;

  const fieldLabels: Record<string, string> = {
    query: 'Query',
    page: 'Page',
    clicks: 'Clicks', 
    impressions: 'Impressions',
    ctr: 'CTR',
    position: 'Position'
  };

  return (
    <div className="space-y-6">
      {/* Required Columns - Simple mapping interface */}
      <div>
        <h4 className="font-medium text-gray-900 mb-4">Required Columns</h4>
        <div className="space-y-4">
          {Object.keys(mappings).map((field) => {
            const isRequired = requiredFields.includes(field);
            const fieldLabel = fieldLabels[field];
            
            return (
              <div key={field} className="bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-200 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {fieldLabel}
                      {isRequired && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    <Select
                      value={mappings[field] || "none"}
                      onValueChange={(value) => setMappings(prev => ({ ...prev, [field]: value === "none" ? '' : value }))}
                    >
                      <SelectTrigger className={`w-full ${mappings[field] ? 'border-blue-500 bg-blue-50' : ''}`}>
                        <SelectValue placeholder="-- Not mapped --" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">-- Not mapped --</SelectItem>
                        {headers.map((header) => (
                          <SelectItem key={header} value={header}>{header}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="ml-4">
                    {mappings[field] ? (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress Summary - Link Boosting Style */}
      <div className={`p-4 rounded-lg ${allRequiredMapped ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            {allRequiredMapped ? (
              <>
                <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
                <span className="text-green-700 font-medium">All required columns mapped</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-5 w-5 text-orange-600 mr-2" />
                <span className="text-orange-700 font-medium">{remainingCount} required columns remaining</span>
              </>
            )}
          </div>
          <span className="text-sm text-gray-600">{mappedCount}/{requiredFields.length} completed</span>
        </div>
      </div>

      {/* Save Button - Link Boosting Style */}
      <Button 
        onClick={() => onSave(mappings)} 
        disabled={!allRequiredMapped || isProcessing} 
        className="w-full bg-blue-600 hover:bg-blue-700 py-3 text-white font-medium"
      >
        {isProcessing ? (
          <>
            <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
            Saving GSC Data Column Mapping...
          </>
        ) : (
          'Save GSC Data Column Mapping'
        )}
      </Button>
    </div>
  );
}

// Product Feed Mapping Component
function ProductFeedMapping({ headers, onSave, isProcessing }: { headers: string[]; onSave: (mappings: Record<string, string>) => void; isProcessing: boolean }) {
  const [mappings, setMappings] = useState<Record<string, string>>({
    name: '', urlSlug: '', description: '', shortDescription: '', featuredImage: '', recordId: ''
  });

  const requiredFields = ['name', 'urlSlug', 'recordId'];
  const allRequiredMapped = requiredFields.every(field => mappings[field]);
  const mappedCount = requiredFields.filter(field => mappings[field]).length;
  const remainingCount = requiredFields.length - mappedCount;

  const fieldLabels: Record<string, string> = {
    name: 'Product Name',
    urlSlug: 'Product URL',
    description: 'Product Description',
    shortDescription: 'Short Description',
    featuredImage: 'Featured Image',
    recordId: 'Record ID'
  };

  return (
    <div className="space-y-6">
      {/* Required Columns - Link Boosting Style */}
      <div>
        <h4 className="font-medium text-gray-900 mb-4">Required Columns</h4>
        <div className="space-y-4">
          {Object.keys(mappings).map((field) => {
            const isRequired = requiredFields.includes(field);
            const fieldLabel = fieldLabels[field];
            
            return (
              <div key={field} className="bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-200 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {fieldLabel}
                      {isRequired && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    <Select
                      value={mappings[field] || "none"}
                      onValueChange={(value) => setMappings(prev => ({ ...prev, [field]: value === "none" ? '' : value }))}
                    >
                      <SelectTrigger className={`w-full ${mappings[field] ? 'border-blue-500 bg-blue-50' : ''}`}>
                        <SelectValue placeholder="-- Not mapped --" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">-- Not mapped --</SelectItem>
                        {headers.map((header) => (
                          <SelectItem key={header} value={header}>{header}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="ml-4">
                    {mappings[field] ? (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress Summary - Link Boosting Style */}
      <div className={`p-4 rounded-lg ${allRequiredMapped ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            {allRequiredMapped ? (
              <>
                <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
                <span className="text-green-700 font-medium">All required columns mapped</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-5 w-5 text-orange-600 mr-2" />
                <span className="text-orange-700 font-medium">{remainingCount} required columns remaining</span>
              </>
            )}
          </div>
          <span className="text-sm text-gray-600">{mappedCount}/{requiredFields.length} completed</span>
        </div>
      </div>

      {/* Save Button - Link Boosting Style */}
      <Button 
        onClick={() => onSave(mappings)} 
        disabled={!allRequiredMapped || isProcessing} 
        className="w-full bg-blue-600 hover:bg-blue-700 py-3 text-white font-medium"
      >
        {isProcessing ? (
          <>
            <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
            Saving Product Feed Column Mapping...
          </>
        ) : (
          'Save Product Feed Column Mapping'
        )}
      </Button>
    </div>
  );
}

// PLP Feed Mapping Component
function PlpFeedMapping({ headers, onSave, isProcessing }: { headers: string[]; onSave: (mappings: Record<string, string>) => void; isProcessing: boolean }) {
  const [mappings, setMappings] = useState<Record<string, string>>({
    name: '', urlSlug: '', pageType: ''
  });

  const requiredFields = ['name', 'urlSlug', 'pageType'];
  const allRequiredMapped = requiredFields.every(field => mappings[field]);
  const mappedCount = requiredFields.filter(field => mappings[field]).length;
  const remainingCount = requiredFields.length - mappedCount;

  const fieldLabels: Record<string, string> = {
    name: 'Page Name',
    urlSlug: 'URL Slug',
    pageType: 'Page Type'
  };

  return (
    <div className="space-y-6">
      {/* Required Columns - Link Boosting Style */}
      <div>
        <h4 className="font-medium text-gray-900 mb-4">Required Columns</h4>
        <div className="space-y-4">
          {Object.keys(mappings).map((field) => {
            const fieldLabel = fieldLabels[field];
            
            return (
              <div key={field} className="bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-200 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {fieldLabel}
                      <span className="text-red-500 ml-1">*</span>
                    </label>
                    <Select
                      value={mappings[field] || "none"}
                      onValueChange={(value) => setMappings(prev => ({ ...prev, [field]: value === "none" ? '' : value }))}
                    >
                      <SelectTrigger className={`w-full ${mappings[field] ? 'border-blue-500 bg-blue-50' : ''}`}>
                        <SelectValue placeholder="-- Not mapped --" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">-- Not mapped --</SelectItem>
                        {headers.map((header) => (
                          <SelectItem key={header} value={header}>{header}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="ml-4">
                    {mappings[field] ? (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress Summary - Link Boosting Style */}
      <div className={`p-4 rounded-lg ${allRequiredMapped ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            {allRequiredMapped ? (
              <>
                <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
                <span className="text-green-700 font-medium">All required columns mapped</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-5 w-5 text-orange-600 mr-2" />
                <span className="text-orange-700 font-medium">{remainingCount} required columns remaining</span>
              </>
            )}
          </div>
          <span className="text-sm text-gray-600">{mappedCount}/{requiredFields.length} completed</span>
        </div>
      </div>

      {/* Save Button - Link Boosting Style */}
      <Button 
        onClick={() => onSave(mappings)} 
        disabled={!allRequiredMapped || isProcessing} 
        className="w-full bg-blue-600 hover:bg-blue-700 py-3 text-white font-medium"
      >
        {isProcessing ? (
          <>
            <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
            Saving PLP Feed Column Mapping...
          </>
        ) : (
          'Save PLP Feed Column Mapping'
        )}
      </Button>
    </div>
  );
}


// Helper function to find best matching header
const findBestMatch = (headers: string[], candidates: string[]): string | null => {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
  for (const candidate of candidates) {
    const match = normalizedHeaders.find(h => h.includes(candidate.toLowerCase()));
    if (match) {
      return headers[normalizedHeaders.indexOf(match)];
    }
  }
  return null;
};

export default function LowHangingFruitsInputPhase({ projectId, onComplete, onStatusChange, onNavigateToProcessing }: InputPhaseProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('gsc_data');
  const [mappingMode, setMappingMode] = useState<string | null>(null);
  
  const sheetTypes: InputSheetType[] = ['gsc_data', 'product_feed', 'plp_feed'];
  
  const [fileStates, setFileStates] = useState<Record<InputSheetType, FileUploadState>>({
    gsc_data: { file: null, headers: [], data: [], isProcessing: false, error: null, step: 'upload', columnMappings: {} },
    product_feed: { file: null, headers: [], data: [], isProcessing: false, error: null, step: 'upload', columnMappings: {} },
    plp_feed: { file: null, headers: [], data: [], isProcessing: false, error: null, step: 'upload', columnMappings: {} }
  });

  // Load existing input sheets when component mounts
  const { data: existingSheets } = useQuery({
    queryKey: [`/api/lhf-projects/${projectId}/input-sheets`],
    queryFn: async () => {
      const response = await fetch(`/api/lhf-projects/${projectId}/input-sheets`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch input sheets');
      }
      const data = await response.json();
      console.log('LHF INPUT PHASE: Loaded existing sheets:', data);
      return data;
    }
  });

  // Update file states when existing sheets are loaded
  useEffect(() => {
    console.log('LHF INPUT PHASE: useEffect triggered with existingSheets:', existingSheets);
    
    if (existingSheets?.data && Array.isArray(existingSheets.data) && existingSheets.data.length > 0) {
      console.log('LHF INPUT PHASE: Processing existing sheets data:', existingSheets.data);
      
      setFileStates(prevStates => {
        const newFileStates = { ...prevStates };
        
        existingSheets.data.forEach((sheet: any) => {
          console.log('LHF INPUT PHASE: Processing sheet:', sheet);
          if (sheet.sheetType && newFileStates[sheet.sheetType as InputSheetType]) {
            newFileStates[sheet.sheetType as InputSheetType] = {
              ...newFileStates[sheet.sheetType as InputSheetType],
              step: 'complete',
              hasExistingData: true,
              headers: sheet.originalHeaders || [],
              columnMappings: sheet.columnMappings || {}
            };
            console.log('LHF INPUT PHASE: Updated file state for', sheet.sheetType, newFileStates[sheet.sheetType as InputSheetType]);
          }
        });
        
        console.log('LHF INPUT PHASE: Returning new file states:', newFileStates);
        
        // Check if all sheets are complete and notify parent
        const allComplete = Object.values(newFileStates).every(state => state.step === 'complete');
        if (allComplete && onStatusChange) {
          onStatusChange(true);
        }
        
        return newFileStates;
      });
    } else {
      console.log('LHF INPUT PHASE: No existing sheets data found or invalid format', existingSheets);
    }
  }, [existingSheets?.data, onStatusChange]);

  const handleFileUpload = useCallback(async (file: File, sheetType: InputSheetType) => {
    const allowedTypes = ['.csv', '.xlsx', '.xls'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!allowedTypes.includes(fileExtension)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a CSV or Excel file",
        variant: "destructive"
      });
      return;
    }

    setFileStates(prev => ({
      ...prev,
      [sheetType]: { ...prev[sheetType], file, isProcessing: true, error: null }
    }));

    try {
      let headers: string[] = [];
      let dataRows: any[] = [];

      if (file.name.endsWith('.csv')) {
        // Handle CSV files
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsText(file);
        });

        const lines = text.split('\n').filter(line => line.trim() !== '');
        if (lines.length > 0) {
          // Simple CSV parsing - split by comma and trim
          headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '')).filter(h => h !== '');
          dataRows = lines.slice(1).map(line => {
            const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
            const rowObj: any = {};
            headers.forEach((header, index) => {
              rowObj[header] = values[index] || '';
            });
            return rowObj;
          });
        }
      } else {
        // Handle Excel files using dynamic import
        const XLSX = await import('xlsx');
        const data = await new Promise<any>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result);
          reader.onerror = reject;
          reader.readAsArrayBuffer(file);
        });

        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        if (jsonData.length > 0) {
          headers = (jsonData[0] as any[]).map(h => String(h || '').trim()).filter(h => h !== '');
          dataRows = jsonData.slice(1).map((row: any) => {
            const rowObj: any = {};
            headers.forEach((header, index) => {
              rowObj[header] = String(row[index] || '').trim();
            });
            return rowObj;
          });
        }
      }

      setFileStates(prev => ({
        ...prev,
        [sheetType]: {
          ...prev[sheetType],
          headers,
          data: dataRows,
          isProcessing: false,
          step: 'mapping'
        }
      }));

      toast({
        title: "File processed successfully",
        description: `Found ${headers.length} columns and ${dataRows.length} rows`
      });

    } catch (error) {
      setFileStates(prev => ({
        ...prev,
        [sheetType]: { 
          ...prev[sheetType], 
          isProcessing: false, 
          error: `Failed to process file: ${error instanceof Error ? error.message : 'Unknown error'}` 
        }
      }));

      toast({
        title: "Error processing file",
        description: "Failed to read the uploaded file",
        variant: "destructive"
      });
    }
  }, [toast]);

  // Handle feed selection - Just set data for mapping, don't save anything yet
  const handleFeedSelection = async (feedId: number, feedData: any, sheetType: InputSheetType) => {
    try {
      // Get feed headers and data
      const headers = feedData.headers || [];
      const data = feedData.data || [];

      // Update state to show mapping interface (exactly like file upload)
      setFileStates(prev => ({
        ...prev,
        [sheetType]: { 
          ...prev[sheetType], 
          step: 'mapping',  // Show mapping interface
          headers,
          data,
          feedData: {
            feedId: feedId,
            feedName: feedData.feed.name,
            feedType: feedData.feed.type,
            totalRows: feedData.totalRows
          },
          file: null, // No actual file for feeds
          isProcessing: false,
          error: null,
          columnMappings: {} // Start with empty mappings
        }
      }));

      // Switch to mapping mode to show the mapping interface
      setMappingMode(sheetType);

      toast({
        title: "Feed selected",
        description: `${feedData.feed.name} selected. Please review column mappings.`
      });

    } catch (error) {
      setFileStates(prev => ({
        ...prev,
        [sheetType]: { 
          ...prev[sheetType], 
          isProcessing: false, 
          error: `Failed to process feed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          feedData: undefined
        }
      }));

      toast({
        title: "Error selecting feed",
        description: "Failed to process the selected feed",
        variant: "destructive"
      });
    }
  };

  const handleColumnMappingSave = async (sheetType: InputSheetType, mappings: Record<string, string>) => {
    const state = fileStates[sheetType];
    
    setFileStates(prev => ({
      ...prev,
      [sheetType]: { ...prev[sheetType], isProcessing: true, columnMappings: mappings }
    }));

    try {
      const formData = new FormData();
      
      // Handle feed-based vs file-based input differently
      if (state.feedData) {
        // Feed-based input: download actual Excel file from Object Storage and upload like a normal file
        const excelFile = await downloadFeedExcelFile(state.feedData.feedId, state.feedData.feedName);
        formData.append('file', excelFile, `${state.feedData.feedName}_feed.xlsx`);
        formData.append('fileName', `${state.feedData.feedName}_feed.xlsx`);
        formData.append('originalHeaders', JSON.stringify(state.headers));
        formData.append('mappingConfig', JSON.stringify(mappings));
        formData.append('inputMethod', 'upload'); // Treat as file upload
        formData.append('sheetType', sheetType);
      } else {
        // File-based input: upload file with mappings
        formData.append('file', state.file!);
        formData.append('fileName', state.file?.name || 'Unknown file');
        formData.append('originalHeaders', JSON.stringify(state.headers));
        formData.append('mappingConfig', JSON.stringify(mappings));
        formData.append('inputMethod', 'upload');
        formData.append('sheetType', sheetType);
      }

      // Use fetch directly to send FormData
      const response = await fetch(`/api/lhf-projects/${projectId}/input-sheets/${sheetType}`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Failed to save: ${response.statusText}`);
      }

      setFileStates(prev => ({
        ...prev,
        [sheetType]: { ...prev[sheetType], isProcessing: false, step: 'complete' }
      }));

      // Navigate back to input page after column mapping is complete
      setMappingMode(null);

      // Invalidate the input sheets query to refresh the data
      queryClient.invalidateQueries({ queryKey: [`/api/lhf-projects/${projectId}/input-sheets`] });

      const inputMethod = state.feedData ? 'feed' : 'file';
      toast({
        title: "Mapping saved successfully",
        description: `${INPUT_SHEET_CONFIGS[sheetType].title} ${inputMethod} has been configured with column mappings.`
      });
    } catch (error) {
      setFileStates(prev => ({
        ...prev,
        [sheetType]: { ...prev[sheetType], isProcessing: false, error: "Failed to save mappings" }
      }));
      
      toast({
        title: "Error saving mappings",
        description: "Failed to save the column mappings",
        variant: "destructive"
      });
    }
  };


  // Get status for each sheet type  
  const getSheetStatus = (sheetType: InputSheetType) => {
    const state = fileStates[sheetType];
    return {
      uploaded: state.step === 'mapping' || state.step === 'complete' || !!state.hasExistingData,
      processing: state.isProcessing,
      error: !!state.error,
      fileName: state.file?.name,
      rowCount: state.data?.length,
      mappingComplete: state.step === 'complete' && Object.keys(state.columnMappings).length > 0
    };
  };

  const allSheetsComplete = Object.values(fileStates).every(state => state.step === 'complete');
  const totalRows = Object.values(fileStates).reduce((sum, state) => sum + (state.data?.length || 0), 0);

  // If in mapping mode, show the mapping interface
  if (mappingMode) {
    const sheetType = mappingMode as InputSheetType;
    const currentFileState = fileStates[sheetType];
    const currentConfig = INPUT_SHEET_CONFIGS[sheetType];
    
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Map Columns - {currentConfig.title}
          </h2>
          <p className="text-gray-600 text-lg">Map your Excel columns to the required fields</p>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-8">
          <h4 className="font-medium text-blue-900 mb-3">Column Mapping Instructions</h4>
          <ul className="text-sm text-blue-800 space-y-2">
            <li>• Map each required column to the corresponding column from your Excel file</li>
            <li>• Auto-detection has been attempted, but please verify all mappings are correct</li>
            <li>• All required columns must be mapped to continue</li>
          </ul>
        </div>

        {/* Column Mapping Component */}
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          {sheetType === 'gsc_data' && (
            <GscDataMapping 
              headers={currentFileState.headers} 
              onSave={(mappings) => handleColumnMappingSave(sheetType, mappings)} 
              isProcessing={currentFileState.isProcessing} 
            />
          )}
          {sheetType === 'product_feed' && (
            <ProductFeedMapping 
              headers={currentFileState.headers} 
              onSave={(mappings) => handleColumnMappingSave(sheetType, mappings)} 
              isProcessing={currentFileState.isProcessing} 
            />
          )}
          {sheetType === 'plp_feed' && (
            <PlpFeedMapping 
              headers={currentFileState.headers} 
              onSave={(mappings) => handleColumnMappingSave(sheetType, mappings)} 
              isProcessing={currentFileState.isProcessing} 
            />
          )}
        </div>

        {/* Navigation */}
        <div className="flex justify-between items-center pt-8 border-t border-gray-200">
          <Button
            variant="outline"
            onClick={() => setMappingMode(null)}
            className="border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Upload
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Clean Header - Link Boosting Style */}
      <div className="text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-3">Upload Input Sheets</h2>
        <p className="text-gray-600 text-lg">Upload and configure your data sheets for Low Hanging Fruits analysis</p>
      </div>

      {/* Required File Format - Link Boosting Style */}
      <Card className="border-blue-100 bg-blue-50">
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-4">Required File Format</h3>
          <div className="space-y-2 text-sm text-blue-800">
            <div className="flex items-center">
              <CheckCircle className="h-4 w-4 text-blue-600 mr-2 flex-shrink-0" />
              Upload Excel files (.xlsx) or CSV files with your data
            </div>
            <div className="flex items-center">
              <CheckCircle className="h-4 w-4 text-blue-600 mr-2 flex-shrink-0" />
              Required columns: see specific requirements for each sheet below
            </div>
            <div className="flex items-center">
              <CheckCircle className="h-4 w-4 text-blue-600 mr-2 flex-shrink-0" />
              Make sure all data is properly formatted before uploading
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modern Sheet Tabs - Link Boosting Style */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="bg-blue-600 text-white px-6 py-4 rounded-t-xl">
          <h3 className="text-lg font-semibold">Low Hanging Fruits Data Sheets</h3>
        </div>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="p-6">
          <TabsList className="grid w-full grid-cols-3 mb-8 h-12 bg-gray-100 rounded-lg p-1">
            {sheetTypes.map((sheetType) => {
              const config = INPUT_SHEET_CONFIGS[sheetType];
              const status = getSheetStatus(sheetType);
              return (
                <TabsTrigger 
                  key={sheetType}
                  value={sheetType}
                  className="relative data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm h-10 text-sm rounded-md transition-all duration-200 font-medium"
                >
                  <div className="flex items-center space-x-2">
                    {status.uploaded && <CheckCircle className="h-4 w-4 text-current" />}
                    <span>{config.title}</span>
                  </div>
                  {status.uploaded && (
                    <div className="absolute -top-1 -right-1 bg-green-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                      ✓
                    </div>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {sheetTypes.map((sheetType) => {
            const config = INPUT_SHEET_CONFIGS[sheetType];
            const status = getSheetStatus(sheetType);
            const state = fileStates[sheetType];
            
            return (
              <TabsContent key={sheetType} value={sheetType}>
                <SheetTab
                  config={config}
                  status={status}
                  state={state}
                  onFileUpload={(file) => handleFileUpload(file, sheetType)}
                  onStartMapping={() => setMappingMode(sheetType)}
                  onFeedSelection={(feedId, feedData) => handleFeedSelection(feedId, feedData, sheetType)}
                  existingSheets={existingSheets}
                  sheetType={sheetType}
                />
              </TabsContent>
            );
          })}
        </Tabs>
      </div>

      {/* All Input Sheets Ready - Link Boosting Style */}
      {allSheetsComplete && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <CheckCircle className="h-6 w-6 text-green-600 mr-3" />
              <div>
                <div className="font-bold text-green-900 text-lg">All Input Sheets Ready</div>
                <div className="text-green-700 text-sm mt-1">
                  {totalRows.toLocaleString()} total records across 3 sheets with column mappings complete
                </div>
              </div>
            </div>
            <Button
              onClick={() => {
                // Mark completion status and navigate to processing
                if (onComplete) onComplete();
                if (onNavigateToProcessing) onNavigateToProcessing();
              }}
              className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-xl font-medium"
            >
              Continue to Processing
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Tab Component - Link Boosting Style
interface SheetTabProps {
  config: {
    title: string;
    description: string;
    requiredColumns: string[];
    color: string;
  };
  status: {
    uploaded: boolean;
    processing: boolean;
    error: boolean;
    fileName?: string;
    rowCount?: number;
    mappingComplete: boolean;
  };
  state: FileUploadState;
  onFileUpload: (file: File) => void;
  onStartMapping: () => void;
  onFeedSelection: (feedId: number, feedData: any) => void;
  existingSheets: any;
  sheetType: InputSheetType;
}

function SheetTab({ 
  config, 
  status, 
  state, 
  onFileUpload, 
  onStartMapping, 
  onFeedSelection,
  existingSheets,
  sheetType 
}: SheetTabProps) {
  return (
    <div className="grid md:grid-cols-2 gap-8 min-h-[400px]">
      {/* Upload Section - Link Boosting Style */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
        <div className="w-16 h-16 bg-blue-100 rounded-full mx-auto mb-6 flex items-center justify-center">
          <Upload className="h-8 w-8 text-blue-600" />
        </div>
        
        <h3 className="text-xl font-bold text-gray-900 mb-3">
          Upload {config.title}
        </h3>
        <p className="text-gray-600 mb-2">
          {config.description}
        </p>
        <p className="text-sm text-blue-600 mb-6">
          Required columns: {config.requiredColumns.join(', ')}
        </p>

        {!status.uploaded && !state.hasExistingData ? (
          <div className="space-y-4">
            <input
              type="file"
              accept=".xlsx,.csv,.xls"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileUpload(file);
              }}
              disabled={state.isProcessing}
              className="hidden"
              id={`file-upload-${sheetType}`}
            />
            <label htmlFor={`file-upload-${sheetType}`}>
              <Button
                type="button"
                disabled={state.isProcessing}
                className="bg-blue-600 hover:bg-blue-700 px-8 py-3 text-white font-medium cursor-pointer"
                asChild
              >
                <span>
                  {state.isProcessing ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Choose File
                    </>
                  )}
                </span>
              </Button>
            </label>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-green-50 rounded-lg p-4 border border-green-200">
              <div className="text-green-700 font-semibold flex items-center justify-center mb-2">
                <CheckCircle className="h-5 w-5 mr-2" />
                File Uploaded Successfully
              </div>
              <div className="text-green-600 text-sm">
                {status.fileName || (existingSheets?.data?.find((s: any) => s.sheetType === sheetType)?.fileName)} • {status.rowCount || (existingSheets?.data?.find((s: any) => s.sheetType === sheetType)?.rowCount)} rows
              </div>
            </div>
            
            {/* Column Mapping Status */}
            {state.step === 'mapping' ? (
              <Button
                onClick={onStartMapping}
                className="bg-blue-600 hover:bg-blue-700 w-full text-white py-3 font-medium"
              >
                Continue to Column Mapping
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : status.mappingComplete ? (
              <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                <div className="text-blue-700 font-medium flex items-center justify-center">
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Column Mapping Complete
                </div>
              </div>
            ) : null}

          </div>
        )}
      </div>

      {/* Enhanced Feed Selection Interface */}
      <div className={`border-2 transition-all duration-300 hover:shadow-lg ${
        (status.uploaded && state.feedData) || (status.uploaded && !state.feedData)
          ? 'border-purple-200 bg-gradient-to-br from-purple-50 to-purple-100' 
          : 'border-dashed border-gray-300 hover:border-purple-400 bg-gradient-to-br from-gray-50 to-white'
      } rounded-lg p-8 text-center`}>
        {state.feedData ? (
          // Feed Selected Success State
          <div className="space-y-4">
            <div className="w-16 h-16 bg-purple-500 text-white rounded-full mx-auto mb-6 flex items-center justify-center shadow-lg">
              <Database className="h-8 w-8" />
            </div>
            
            <div className="bg-white/80 rounded-xl p-4 border border-purple-200">
              <div className="text-purple-700 font-bold text-lg flex items-center justify-center mb-2">
                <CheckCircle className="h-6 w-6 mr-2" />
                Feed Selected Successfully
              </div>
              <div className="text-purple-600 text-sm mb-2">
                Using feed: {state.feedData.feedName}
              </div>
              <div className="text-purple-600 text-sm">
                {state.feedData.totalRows.toLocaleString()} rows available
              </div>
            </div>

            {/* Column Mapping Button or Status */}
            {state.step === 'mapping' ? (
              <Button
                onClick={onStartMapping}
                className="bg-purple-600 hover:bg-purple-700 w-full text-white py-3 rounded-xl font-medium"
              >
                Continue to Column Mapping
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : status.mappingComplete ? (
              <div className="bg-purple-50 rounded-xl p-4 border border-purple-200">
                <div className="text-purple-700 font-medium flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 mr-2" />
                  Column Mapping Complete
                </div>
              </div>
            ) : null}

            <Button
              variant="outline"
              onClick={() => {
                // Reset feed selection state
                setState(prev => ({
                  ...prev,
                  feedData: undefined,
                  file: null,
                  step: 'upload',
                  hasExistingData: false
                }));
              }}
              className="border-purple-200 text-purple-700 hover:bg-purple-50 px-6 py-2"
            >
              Choose Different Feed
            </Button>
          </div>
        ) : status.uploaded && !state.feedData ? (
          // Regular File Upload Success State  
          <div className="space-y-4">
            <div className="w-16 h-16 bg-green-500 text-white rounded-full mx-auto mb-6 flex items-center justify-center shadow-lg">
              <CheckCircle className="h-8 w-8" />
            </div>
            
            <div className="bg-white/80 rounded-xl p-4 border border-green-200">
              <div className="text-green-700 font-bold text-lg flex items-center justify-center mb-2">
                <CheckCircle className="h-6 w-6 mr-2" />
                File Uploaded Successfully
              </div>
              <div className="text-green-600 text-sm">
                {status.fileName || (existingSheets?.data?.find((s: any) => s.sheetType === sheetType)?.fileName)} • {status.rowCount || (existingSheets?.data?.find((s: any) => s.sheetType === sheetType)?.rowCount)} rows
              </div>
            </div>
          </div>
        ) : (
          // Feed Selection State
          <div className="space-y-6">
            <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-purple-200 rounded-full mx-auto mb-6 flex items-center justify-center hover:from-purple-200 hover:to-purple-300 transition-all duration-300 group">
              <Database className="h-8 w-8 text-purple-600 group-hover:scale-110 transition-transform duration-300" />
            </div>
            
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                Choose from Feed Library
              </h3>
              <p className="text-gray-600 mb-4">
                Select from your existing {config.title.toLowerCase()} feeds
              </p>
              <div className="bg-blue-50 rounded-lg p-3 mb-6">
                <div className="text-sm text-blue-700 flex items-center">
                  <Database className="h-4 w-4 mr-2" />
                  <span className="font-medium">Smart feed matching:</span>
                  <span className="ml-1">Automatically selects compatible {config.title} data</span>
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 mb-6">
                <div className="text-xs text-gray-600">
                  <strong>Required columns:</strong> {config.requiredColumns.join(', ')}
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-400/20 to-blue-400/20 rounded-xl blur-xl"></div>
              <div className="relative bg-white rounded-xl border-2 border-purple-200 p-4">
                <FeedSelector
                  onFeedSelected={(feedId, feedData) => {
                    onFeedSelection(feedId, feedData);
                  }}
                  feedType={sheetType === 'gsc_data' ? 'General Feed' : sheetType === 'product_feed' ? 'Product Feed' : 'Product Listing Page'}
                  className="w-full px-8 py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-xl font-medium transition-all duration-200 hover:scale-105 shadow-lg hover:shadow-xl"
                />
              </div>
            </div>

            <div className="text-xs text-gray-500 space-y-1">
              <div className="flex items-center justify-center">
                <CheckCircle className="h-3 w-3 mr-1 text-green-500" />
                No file upload required
              </div>
              <div className="flex items-center justify-center">
                <CheckCircle className="h-3 w-3 mr-1 text-green-500" />
                Instant data access
              </div>
              <div className="flex items-center justify-center">
                <CheckCircle className="h-3 w-3 mr-1 text-green-500" />
                Pre-validated data format
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}