import * as XLSX from 'xlsx';
import { ObjectStorageManager } from '../../../utils/object-storage.js';

/**
 * Low Hanging Fruits Object Storage Data Service
 * Handles reading and parsing Excel data from Object Storage with column mapping
 */
export class LHFObjectStorageDataService {
  private projectId: number;
  
  constructor(projectId: number) {
    this.projectId = projectId;
  }

  /**
   * Parse GSC (Google Search Console) data from Object Storage Excel file
   * @param mappingConfig Column mapping configuration from lhf_input_sheets_data
   * @returns Parsed GSC data array matching database structure
   */
  async parseGscData(mappingConfig: any): Promise<any[]> {
    try {
      const sheetName = 'gsc_data.xlsx';
      const buffer = await ObjectStorageManager.downloadLHFInputSheetLegacy(this.projectId, sheetName);
      const workbook = XLSX.read(buffer);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet);

      console.log(`📊 LHF GSC DATA: Parsing ${rawData.length} rows from Object Storage`);

      // Clean up column headers by trimming whitespace
      const cleanedData = rawData.map(row => {
        const cleanedRow: any = {};
        Object.keys(row).forEach(key => {
          const cleanKey = key.trim();
          cleanedRow[cleanKey] = row[key];
        });
        return cleanedRow;
      });

      // Apply column mapping to transform raw Excel data to database structure
      return cleanedData.map((row: any, index: number) => ({
        projectId: this.projectId,
        query: this.getMappedValue(row, mappingConfig, 'query') || '',
        page: this.getMappedValue(row, mappingConfig, 'page') || '',
        clicks: this.parseInteger(this.getMappedValue(row, mappingConfig, 'clicks')),
        impressions: this.parseInteger(this.getMappedValue(row, mappingConfig, 'impressions')),
        ctr: this.getMappedValue(row, mappingConfig, 'ctr') || '',
        position: this.getMappedValue(row, mappingConfig, 'position') || ''
      }));
    } catch (error) {
      console.error(`❌ Error parsing GSC data from Object Storage:`, error);
      throw new Error(`Failed to parse GSC data: No Object Storage file found for project ${this.projectId}. Please upload GSC data using the upload interface.`);
    }
  }

  /**
   * Parse Product Feed data from Object Storage Excel file
   * @param mappingConfig Column mapping configuration from lhf_input_sheets_data  
   * @returns Parsed product feed data array with dynamic attributes
   */
  async parseProductFeedData(mappingConfig: any): Promise<any[]> {
    try {
      const sheetName = 'product_feed.xlsx';
      const buffer = await ObjectStorageManager.downloadLHFInputSheetLegacy(this.projectId, sheetName);
      const workbook = XLSX.read(buffer);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet);

      console.log(`📊 LHF PRODUCT DATA: Parsing ${rawData.length} rows from Object Storage`);

      // Clean up column headers by trimming whitespace
      const cleanedData = rawData.map(row => {
        const cleanedRow: any = {};
        Object.keys(row).forEach(key => {
          const cleanKey = key.trim();
          cleanedRow[cleanKey] = row[key];
        });
        return cleanedRow;
      });

      // Debug first row to check actual column names and values
      if (cleanedData.length > 0) {
        console.log(`🔍 LHF PRODUCT DEBUG: First row columns after cleaning:`, Object.keys(cleanedData[0]));
        console.log(`🔍 LHF PRODUCT DEBUG: Sample name value from 'Name' column:`, cleanedData[0]['Name']);
        console.log(`🔍 LHF PRODUCT DEBUG: Mapping config for name:`, mappingConfig.name);
        console.log(`🔍 LHF PRODUCT DEBUG: getMappedValue result:`, this.getMappedValue(cleanedData[0], mappingConfig, 'name'));
      }

      // Apply column mapping to transform raw Excel data to database structure
      return cleanedData.map((row: any, index: number) => {
        const mappedName = this.getMappedValue(row, mappingConfig, 'name') || '';
        
        // Additional debug for first few rows
        if (index < 3) {
          console.log(`🔍 LHF PRODUCT DEBUG Row ${index}: Raw name='${row['Name']}', Mapped name='${mappedName}'`);
        }
        
        return {
          projectId: this.projectId,
          name: mappedName,
          urlSlug: this.getMappedValue(row, mappingConfig, 'urlSlug') || '',
          description: this.getMappedValue(row, mappingConfig, 'description') || '',
          shortDescription: this.getMappedValue(row, mappingConfig, 'shortDescription') || '',
          featuredImage: this.getMappedValue(row, mappingConfig, 'featuredImage') || '',
          recordId: this.getMappedValue(row, mappingConfig, 'recordId') || ''
        };
      });
    } catch (error) {
      console.error(`❌ Error parsing Product Feed data from Object Storage:`, error);
      throw new Error(`Failed to parse Product Feed data: No Object Storage file found for project ${this.projectId}. Please upload Product Feed data using the upload interface.`);
    }
  }

  /**
   * Parse Product Category (PLP) data from Object Storage Excel file
   * @param mappingConfig Column mapping configuration from lhf_input_sheets_data
   * @returns Parsed PLP feed data array matching database structure
   */
  async parseProductCategoryData(mappingConfig: any): Promise<any[]> {
    try {
      const sheetName = 'plp_feed.xlsx';
      const buffer = await ObjectStorageManager.downloadLHFInputSheetLegacy(this.projectId, sheetName);
      const workbook = XLSX.read(buffer);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet);

      console.log(`📊 LHF PLP DATA: Parsing ${rawData.length} rows from Object Storage`);

      // Clean up column headers by trimming whitespace
      const cleanedData = rawData.map(row => {
        const cleanedRow: any = {};
        Object.keys(row).forEach(key => {
          const cleanKey = key.trim();
          cleanedRow[cleanKey] = row[key];
        });
        return cleanedRow;
      });

      // Apply column mapping to transform raw Excel data to database structure
      return cleanedData.map((row: any, index: number) => ({
        projectId: this.projectId,
        name: this.getMappedValue(row, mappingConfig, 'name') || '',
        urlSlug: this.getMappedValue(row, mappingConfig, 'urlSlug') || '',
        pageType: this.getMappedValue(row, mappingConfig, 'pageType') || ''
      }));
    } catch (error) {
      console.error(`❌ Error parsing PLP data from Object Storage:`, error);
      throw new Error(`Failed to parse PLP data: No Object Storage file found for project ${this.projectId}. Please upload PLP Feed data using the upload interface.`);
    }
  }

  /**
   * Get mapped value from raw row data using column mapping configuration
   * @param row Raw Excel row data
   * @param mappingConfig Column mapping configuration
   * @param targetField Target database field name
   * @returns Mapped value or null
   */
  private getMappedValue(row: any, mappingConfig: any, targetField: string): any {
    if (!mappingConfig || !mappingConfig[targetField]) {
      console.log(`⚠️ LHF MAPPING: No mapping config found for field '${targetField}'`);
      return null;
    }

    const sourceColumn = mappingConfig[targetField];
    let value = row[sourceColumn];
    
    // If direct mapping fails, try with trimmed column names (handles spaces in headers)
    if (!value && sourceColumn) {
      // Try to find column with trimmed source column name
      const trimmedSourceColumn = sourceColumn.trim();
      value = row[trimmedSourceColumn];
      
      // If still not found, try to find any column that matches when both are trimmed
      if (!value) {
        const rowKeys = Object.keys(row);
        const matchingKey = rowKeys.find(key => key.trim() === trimmedSourceColumn);
        if (matchingKey) {
          value = row[matchingKey];
        }
      }
    }
    
    // Debug for name field specifically
    if (targetField === 'name') {
      console.log(`🔍 LHF MAPPING DEBUG: targetField='${targetField}', sourceColumn='${sourceColumn}', value='${value}', row keys=[${Object.keys(row).join(', ')}]`);
    }
    
    return value || null;
  }



  /**
   * Parse integer value with fallback to 0
   * @param value String or number value
   * @returns Parsed integer or 0
   */
  private parseInteger(value: any): number {
    if (value === null || value === undefined || value === '') {
      return 0;
    }
    
    const parsed = parseInt(value.toString(), 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Check if all required Object Storage files exist for processing
   * @param requiredSheetTypes Array of required sheet types ('gsc_data', 'product_feed', 'plp_feed')
   * @returns Object with existence status for each sheet type
   */
  async checkRequiredSheetsExist(requiredSheetTypes: string[]): Promise<{[key: string]: boolean}> {
    const sheetStatus: {[key: string]: boolean} = {};
    
    for (const sheetType of requiredSheetTypes) {
      const sheetName = `${sheetType}.xlsx`;
      try {
        sheetStatus[sheetType] = await ObjectStorageManager.lhfInputSheetExistsLegacy(this.projectId, sheetName);
      } catch (error) {
        sheetStatus[sheetType] = false;
      }
    }
    
    console.log(`🔍 LHF SHEET STATUS: Project ${this.projectId}`, sheetStatus);
    return sheetStatus;
  }

  /**
   * Get user-friendly error message for missing Object Storage files
   * @param missingSheets Array of missing sheet types
   * @returns Formatted error message with upload guidance
   */
  getMissingFilesErrorMessage(missingSheets: string[]): string {
    const sheetTypeNames: {[key: string]: string} = {
      'gsc_data': 'GSC Data',
      'product_feed': 'Product Feed', 
      'plp_feed': 'PLP Feed'
    };

    const missingNames = missingSheets.map(type => sheetTypeNames[type] || type);
    
    return `Missing required Object Storage files for processing: ${missingNames.join(', ')}. Please upload these files using the Feed Sheet Input interface before starting processing.`;
  }
}