import { IStorage } from '../../storage';
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { ObjectStorageManager } from '../../utils/object-storage';
import { LHFObjectStorageDataService } from './services/lhf-object-storage-data-service';
import { db } from '../../db';
import { projects } from '../../../shared/schema';
import { eq } from 'drizzle-orm';

interface ProcessingSettings {
  projectId: number;
}

export class LowHangingFruitsProcessor {
  private storage: IStorage;
  private objectStorageDataService: LHFObjectStorageDataService;
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private currentProgress = 0;
  private currentStatus = 'idle';
  private logs: string[] = [];
  
  constructor(storage: IStorage) {
    this.storage = storage;
    this.objectStorageDataService = new LHFObjectStorageDataService(storage);
  }

  // Main processing function that matches the Python code workflow
  async startProcessing(settings: ProcessingSettings, notifyCallback?: (message: any) => void): Promise<void> {
    try {
      this.isProcessing = true;
      this.currentProgress = 0;
      this.currentStatus = 'processing';
      this.logs = [];
      
      this.log('Process started');
      this.updateProgress(5, 'Loading configuration...');
      
      // Clear any existing processing data
      await this.clearPreviousProcessingData(settings.projectId);
      
      this.updateProgress(10, 'Loading input data...');
      
      // Load the three input sheets from Object Storage
      const gscData = await this.objectStorageDataService.readGscData(settings.projectId);
      const productFeed = await this.objectStorageDataService.readProductData(settings.projectId);  
      const plpFeed = await this.objectStorageDataService.readPlpData(settings.projectId);
      
      this.log(`Loaded ${gscData.length} GSC records, ${productFeed.length} products, ${plpFeed.length} PLPs`);
      this.updateProgress(20, 'Normalizing keys for matching...');
      
      // Step 1: Data normalization - create universal 'Matching_Key' everywhere
      const normalizedGscData = this.normalizeGscData(gscData);
      const normalizedProductFeed = this.normalizeProductFeed(productFeed);
      const normalizedPlpFeed = this.normalizePlpFeed(plpFeed);
      
      this.updateProgress(30, 'Classifying GSC data using master lists...');
      
      // Step 2: Classification - classify GSC data using master lists
      const classifiedGscData = this.classifyGscData(normalizedGscData, normalizedProductFeed, normalizedPlpFeed);
      
      this.updateProgress(40, 'Splitting GSC data for processing...');
      
      // Step 3: Split GSC data into product and category pipelines
      const gscProductsOnly = classifiedGscData.filter(item => item.urlType === 'Product');
      const gscCategoriesOnly = classifiedGscData.filter(item => item.urlType === 'Category');
      
      this.log(`Split data: ${gscProductsOnly.length} product records, ${gscCategoriesOnly.length} category records`);
      
      this.updateProgress(60, 'Processing product pipeline...');
      
      // Step 4: Run product pipeline
      const finalProducts = await this.processProductData(gscProductsOnly, normalizedProductFeed);
      
      this.updateProgress(80, 'Processing category pipeline...');
      
      // Step 5: Run category pipeline
      const finalCategories = await this.processCategoryData(gscCategoriesOnly, normalizedPlpFeed);
      
      this.updateProgress(90, 'Saving results to Excel file...');
      
      // Step 6: Save results to Excel file
      await this.saveResultsToExcel(settings.projectId, finalProducts, finalCategories);
      
      this.updateProgress(100, 'Analysis complete!');
      this.log('Analysis complete!');
      
      // Update database status to completed for page refresh detection
      try {
        // Use a direct database update approach for status
        await this.updateProjectStatus(settings.projectId, 'completed');
        this.log('✅ Database status updated to completed');
      } catch (dbError) {
        this.log(`⚠️ Failed to update database status: ${dbError}`);
      }
      
      this.isProcessing = false;
      this.currentStatus = 'completed';
      
      if (notifyCallback) {
        notifyCallback({
          type: 'processing_complete',
          projectId: settings.projectId,
          status: 'completed'
        });
      }
      
    } catch (error: any) {
      this.log(`ERROR: ${error?.message || 'Unknown error'}`);
      this.isProcessing = false;
      this.currentStatus = 'failed';
      
      if (notifyCallback) {
        notifyCallback({
          type: 'processing_error', 
          projectId: settings.projectId,
          error: error?.message || 'Unknown error'
        });
      }
      
      throw error;
    }
  }

  // Universal slug formula from Python code
  private getCleanSlug(urlString: string): string | null {
    if (!urlString || typeof urlString !== 'string') {
      return null;
    }
    
    // This regex robustly finds the last segment of a path
    const match = urlString.match(/\/([^\/?#]+)\/?$/);
    if (match) {
      return match[1];
    }
    
    // If no path structure is found, it's likely already a clean slug
    return urlString;
  }

  private normalizeGscData(gscData: any[]): any[] {
    return gscData.map(item => ({
      ...item,
      matchingKey: this.getCleanSlug(item.page || '')
    }));
  }

  private normalizeProductFeed(productFeed: any[]): any[] {
    return productFeed.map(item => ({
      ...item,
      matchingKey: this.getCleanSlug(item.urlSlug || '')
    }));
  }

  private normalizePlpFeed(plpFeed: any[]): any[] {
    return plpFeed.map(item => ({
      ...item,
      matchingKey: this.getCleanSlug(item.urlSlug || '')
    }));
  }

  private classifyGscData(gscData: any[], productFeed: any[], plpFeed: any[]): any[] {
    const productKeys = new Set(productFeed.map(item => item.matchingKey));
    const categoryKeys = new Set(plpFeed.map(item => item.matchingKey));
    
    return gscData.map(item => ({
      ...item,
      urlType: productKeys.has(item.matchingKey) ? 'Product' : 
               categoryKeys.has(item.matchingKey) ? 'Category' : 'Other'
    }));
  }

  // Process product data - exact Python implementation
  private async processProductData(gscProductsData: any[], productsData: any[]): Promise<any[]> {
    this.log('--- Starting Product Pipeline ---');
    
    // Step 1: Calculate Clicks_pct_vs_page
    const pageClickTotals = new Map<string, number>();
    gscProductsData.forEach(item => {
      const key = item.matchingKey;
      const clicks = parseInt(item.clicks) || 0;
      pageClickTotals.set(key, (pageClickTotals.get(key) || 0) + clicks);
    });
    
    const enhancedGscData = gscProductsData.map(item => ({
      ...item,
      clicksPctVsPage: pageClickTotals.get(item.matchingKey) && pageClickTotals.get(item.matchingKey)! > 0 ? 
        (parseInt(item.clicks) || 0) / pageClickTotals.get(item.matchingKey)! : 0
    }));

    this.log('✅ [Products] Calculated \'Clicks_pct_vs_page\'.');
    
    // Steps 3 & 4: Aggregate all SEO metrics  
    enhancedGscData.sort((a, b) => {
      if (a.matchingKey !== b.matchingKey) return a.matchingKey.localeCompare(b.matchingKey);
      if (a.clicksPctVsPage !== b.clicksPctVsPage) return b.clicksPctVsPage - a.clicksPctVsPage;
      return (parseInt(b.clicks) || 0) - (parseInt(a.clicks) || 0);
    });
    
    const seoMetrics = new Map<string, any>();
    
    for (const key of new Set(enhancedGscData.map(item => item.matchingKey))) {
      const keyData = enhancedGscData.filter(item => item.matchingKey === key);
      
      const totalClicks = keyData.reduce((sum, item) => sum + (parseInt(item.clicks) || 0), 0);
      const totalImpressions = keyData.reduce((sum, item) => sum + (parseInt(item.impressions) || 0), 0);
      const avgPosition = keyData.reduce((sum, item) => sum + (parseFloat(item.position) || 0), 0) / keyData.length;
      
      const secondaryQueries = keyData.slice(1, 6).map(item => item.query).filter(q => q).join(', ');
      
      seoMetrics.set(key, {
        matchingKey: key,
        topQuery: keyData[0]?.query || '',
        secondaryQuery: secondaryQueries,
        totalClicks: totalClicks,
        totalImpressions: totalImpressions,
        averagePosition: Math.round(avgPosition * 100) / 100,
        ctr: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 100 : 0
      });
    }
    
    this.log('✅ [Products] Aggregated all SEO metrics.');
    
    // Step 5: Merge calculated data back into the main product list
    const finalProducts = productsData.map(product => {
      const metrics = seoMetrics.get(product.matchingKey);
      return {
        ...product,
        topQuery: metrics?.topQuery || '',
        secondaryQuery: metrics?.secondaryQuery || '',
        averagePosition: metrics?.averagePosition || 0,
        totalClicks: metrics?.totalClicks || 0,
        totalImpressions: metrics?.totalImpressions || 0,
        ctr: metrics?.ctr ? `${metrics.ctr}%` : '0%'
      };
    });
    
    this.log('✅ [Products] Merged SEO data into product feed.');
    return finalProducts;
  }

  // Process category data - exact Python implementation  
  private async processCategoryData(gscCategoriesData: any[], categoriesData: any[]): Promise<any[]> {
    this.log('--- Starting Category Pipeline ---');
    
    // Step 1: Calculate Clicks_pct_vs_page
    const pageClickTotals = new Map<string, number>();
    gscCategoriesData.forEach(item => {
      const key = item.matchingKey;
      const clicks = parseInt(item.clicks) || 0;
      pageClickTotals.set(key, (pageClickTotals.get(key) || 0) + clicks);
    });
    
    const enhancedGscData = gscCategoriesData.map(item => ({
      ...item,
      clicksPctVsPage: pageClickTotals.get(item.matchingKey) && pageClickTotals.get(item.matchingKey)! > 0 ? 
        (parseInt(item.clicks) || 0) / pageClickTotals.get(item.matchingKey)! : 0
    }));

    this.log('✅ [Categories] Calculated \'Clicks_pct_vs_page\'.');
    
    // Step 3: Find Primary and Secondary Keywords
    enhancedGscData.sort((a, b) => {
      if (a.matchingKey !== b.matchingKey) return a.matchingKey.localeCompare(b.matchingKey);
      if (a.clicksPctVsPage !== b.clicksPctVsPage) return b.clicksPctVsPage - a.clicksPctVsPage;
      return (parseInt(b.clicks) || 0) - (parseInt(a.clicks) || 0);
    });
    
    const keywordMetrics = new Map<string, any>();
    
    for (const key of new Set(enhancedGscData.map(item => item.matchingKey))) {
      const keyData = enhancedGscData.filter(item => item.matchingKey === key);
      const secondaryKeywords = keyData.slice(1, 6).map(item => item.query).filter(q => q).join(', ');
      
      keywordMetrics.set(key, {
        matchingKey: key,
        primaryKeyword: keyData[0]?.query || '',
        secondaryKeywords: secondaryKeywords
      });
    }
    
    this.log('✅ [Categories] Extracted primary and secondary keywords.');
    
    // Step 5: Merge data
    const finalCategories = categoriesData.map(category => {
      const metrics = keywordMetrics.get(category.matchingKey);
      return {
        ...category,
        primaryKeyword: metrics?.primaryKeyword || '',
        secondaryKeywords: metrics?.secondaryKeywords || ''
      };
    });
    
    this.log('✅ [Categories] Merged keyword data into category feed.');
    return finalCategories;
  }

  private async saveResultsToExcel(projectId: number, products: any[], categories: any[]): Promise<void> {
    const workbook = XLSX.utils.book_new();
    
    // Remove internal processing fields and projectId from output
    const cleanProducts = products.map(({ matchingKey, projectId, ...rest }) => rest);
    const cleanCategories = categories.map(({ matchingKey, projectId, ...rest }) => rest);
    
    // Create worksheets
    const productsSheet = XLSX.utils.json_to_sheet(cleanProducts);
    const categoriesSheet = XLSX.utils.json_to_sheet(cleanCategories);
    
    XLSX.utils.book_append_sheet(workbook, productsSheet, 'Products_Output_Completed');
    XLSX.utils.book_append_sheet(workbook, categoriesSheet, 'Categ_Output_Completed');
    
    // Write workbook to buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Upload to Object Storage using new hierarchical structure
    await ObjectStorageManager.uploadExcelFileLegacy('low-hanging-fruits', projectId, buffer);
    
    this.log(`💾 Results saved to Object Storage: Output/low-hanging-fruits/project_${projectId}/results.xlsx`);
  }

  private async clearPreviousProcessingData(projectId: number): Promise<void> {
    try {
      // Clear any existing Excel files from Object Storage using new hierarchical structure
      await ObjectStorageManager.clearProjectFilesLegacy('low-hanging-fruits', projectId);
      this.log(`🧹 Cleared previous results from Object Storage`);
    } catch (error: any) {
      console.log('Error clearing previous data:', error);
    }
  }

  // Legacy database methods removed - now using Object Storage Data Service

  private log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    this.logs.push(logEntry);
    console.log(`LHF PROCESSOR: ${logEntry}`);
  }

  private updateProgress(percentage: number, status: string): void {
    this.currentProgress = percentage;
    this.currentStatus = status;
    this.log(status);
  }

  // Public methods for API endpoints
  getProcessingStatus(): { progress: number; status: string; logs: string[] } {
    return {
      progress: this.currentProgress,
      status: this.currentStatus,
      logs: this.logs
    };
  }

  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }

  stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.isProcessing = false;
    this.currentStatus = 'stopped';
  }

  // Direct database update method for status
  private async updateProjectStatus(projectId: number, status: string): Promise<void> {
    await db
      .update(projects)
      .set({ status, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }
}