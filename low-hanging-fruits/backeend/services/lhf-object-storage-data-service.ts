import { LHFObjectStorageDataService as DataService } from './object-storage-data-service';
import { IStorage } from '../../../storage/index.js';

/**
 * Low Hanging Fruits Object Storage Data Service Integration
 * Provides project-specific context and integrates with existing storage interface
 */
export class LHFObjectStorageDataService {
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Load GSC data from Object Storage using column mapping from database
   * Replaces processing engine's loadGscData() method
   */
  async readGscData(projectId: number): Promise<any[]> {
    try {
      // Get mapping configuration from lhf_input_sheets_data table
      const mappingConfig = await this.getMappingConfig(projectId, 'gsc_data');
      
      if (!mappingConfig) {
        throw new Error(`No GSC data mapping configuration found for project ${projectId}. Please upload and configure GSC data first.`);
      }

      // Create data service instance for this specific project
      const dataService = new DataService(projectId);
      return await dataService.parseGscData(mappingConfig);
    } catch (error: any) {
      console.error(`❌ Failed to load GSC data from Object Storage:`, error);
      throw error;
    }
  }

  /**
   * Load Product Feed data from Object Storage using column mapping from database
   * Replaces processing engine's loadProductFeedData() method
   */
  async readProductData(projectId: number): Promise<any[]> {
    try {
      // Get mapping configuration from lhf_input_sheets_data table
      const mappingConfig = await this.getMappingConfig(projectId, 'product_feed');
      
      if (!mappingConfig) {
        throw new Error(`No Product Feed mapping configuration found for project ${projectId}. Please upload and configure Product Feed data first.`);
      }

      // Create data service instance for this specific project
      const dataService = new DataService(projectId);
      return await dataService.parseProductFeedData(mappingConfig);
    } catch (error: any) {
      console.error(`❌ Failed to load Product Feed data from Object Storage:`, error);
      throw error;
    }
  }

  /**
   * Load PLP Feed data from Object Storage using column mapping from database
   * Replaces processing engine's loadPlpFeedData() method  
   */
  async readPlpData(projectId: number): Promise<any[]> {
    try {
      // Get mapping configuration from lhf_input_sheets_data table
      const mappingConfig = await this.getMappingConfig(projectId, 'plp_feed');
      
      if (!mappingConfig) {
        throw new Error(`No PLP Feed mapping configuration found for project ${projectId}. Please upload and configure PLP Feed data first.`);
      }

      // Create data service instance for this specific project
      const dataService = new DataService(projectId);
      return await dataService.parseProductCategoryData(mappingConfig);
    } catch (error: any) {
      console.error(`❌ Failed to load PLP Feed data from Object Storage:`, error);
      throw error;
    }
  }

  /**
   * Get column mapping configuration from database for specific sheet type
   * @param projectId Project ID
   * @param sheetType Sheet type ('gsc_data', 'product_feed', 'plp_feed')
   * @returns Mapping configuration object or null
   */
  private async getMappingConfig(projectId: number, sheetType: string): Promise<any | null> {
    try {
      // Query lhf_input_sheets_data table for mapping configuration
      const sheetMetadata = await this.storage.getLHFInputSheetsData(projectId, sheetType);
      
      if (!sheetMetadata || !sheetMetadata.mappingConfig) {
        console.warn(`⚠️ No mapping configuration found for sheet type: ${sheetType}`);
        return null;
      }

      console.log(`✅ Found mapping configuration for ${sheetType}:`, Object.keys(sheetMetadata.mappingConfig));
      return sheetMetadata.mappingConfig;
    } catch (error: any) {
      console.error(`❌ Error retrieving mapping config for ${sheetType}:`, error);
      return null;
    }
  }

  /**
   * Check if all required Object Storage files exist and have mapping configurations
   * @param requiredSheetTypes Array of required sheet types
   * @returns Validation result with detailed status
   */
  async validateRequiredDataExists(requiredSheetTypes: string[] = ['gsc_data', 'product_feed', 'plp_feed']): Promise<{
    isValid: boolean;
    missingFiles: string[];
    missingMappings: string[];
    errorMessage?: string;
  }> {
    try {
      // Check Object Storage file existence
      const fileStatus = await this.dataService.checkRequiredSheetsExist(requiredSheetTypes);
      const missingFiles = requiredSheetTypes.filter(type => !fileStatus[type]);

      // Check mapping configuration existence
      const missingMappings: string[] = [];
      for (const sheetType of requiredSheetTypes) {
        const mappingConfig = await this.getMappingConfig(sheetType);
        if (!mappingConfig) {
          missingMappings.push(sheetType);
        }
      }

      const isValid = missingFiles.length === 0 && missingMappings.length === 0;

      let errorMessage: string | undefined;
      if (!isValid) {
        const errors: string[] = [];
        if (missingFiles.length > 0) {
          errors.push(this.dataService.getMissingFilesErrorMessage(missingFiles));
        }
        if (missingMappings.length > 0) {
          errors.push(`Missing column mapping configurations: ${missingMappings.join(', ')}. Please complete column mapping for these sheets.`);
        }
        errorMessage = errors.join(' ');
      }

      return {
        isValid,
        missingFiles,
        missingMappings,
        errorMessage
      };
    } catch (error) {
      console.error(`❌ Error validating required data:`, error);
      return {
        isValid: false,
        missingFiles: requiredSheetTypes,
        missingMappings: requiredSheetTypes,
        errorMessage: `Failed to validate required data: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Get data loading statistics for project dashboard
   * @returns Object with row counts and file status
   */
  async getDataStatistics(): Promise<{
    gscDataCount: number;
    productFeedCount: number;
    plpFeedCount: number;
    hasObjectStorageFiles: boolean;
    hasMappingConfigurations: boolean;
  }> {
    try {
      const validation = await this.validateRequiredDataExists();
      
      let gscDataCount = 0;
      let productFeedCount = 0;
      let plpFeedCount = 0;

      // If data is valid, get actual row counts
      if (validation.isValid) {
        try {
          const gscData = await this.loadGscData();
          const productData = await this.loadProductFeedData();
          const plpData = await this.loadPlpFeedData();
          
          gscDataCount = gscData.length;
          productFeedCount = productData.length;
          plpFeedCount = plpData.length;
        } catch (error) {
          console.warn(`⚠️ Could not load data for statistics:`, error);
        }
      }

      return {
        gscDataCount,
        productFeedCount,
        plpFeedCount,
        hasObjectStorageFiles: validation.missingFiles.length === 0,
        hasMappingConfigurations: validation.missingMappings.length === 0
      };
    } catch (error) {
      console.error(`❌ Error getting data statistics:`, error);
      return {
        gscDataCount: 0,
        productFeedCount: 0,
        plpFeedCount: 0,
        hasObjectStorageFiles: false,
        hasMappingConfigurations: false
      };
    }
  }
}