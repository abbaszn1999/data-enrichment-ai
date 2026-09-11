import { Router } from 'express';
import { requireAuth } from '../../core/auth/middleware';
import { storage } from '../../storage';
import { FeedDatabaseStorage } from '../../storage/feed-storage';
import { LowHangingFruitsProcessor } from './processing-engine';
import * as path from 'path';
import * as fs from 'fs';
import XLSX from 'xlsx';
import multer from 'multer';
import { ObjectStorageManager } from '../../utils/object-storage';
import { 
  insertLHFInputSheetsSchema,
  insertLHFGscDataSchema,
  insertLHFProductFeedDataSchema,
  insertLHFPlpFeedDataSchema,
  insertLHFColumnMappingsSchema
} from '../../../shared/schema';

// Helper function to handle feed-based input (no file upload)
async function handleFeedBasedInput({
  projectId,
  sheetType,
  feedId,
  feedName,
  fileName,
  originalHeaders,
  mappingConfig,
  storage,
  userId,
  res
}: any) {
  try {
    console.log('📄 LHF FEED INPUT:', { projectId, sheetType, feedId, feedName });
    
    // Parse JSON strings
    const parsedHeaders = JSON.parse(originalHeaders || '[]');
    const parsedMappingConfig = JSON.parse(mappingConfig || '{}');

    if (!feedId || !feedName || !parsedHeaders || !parsedMappingConfig) {
      return res.status(400).json({ message: "Missing required feed data" });
    }

    // Get project and workspace info first
    const project = await storage.getLHFProject(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Get feed metadata and data to calculate row count
    const feedStorage = new FeedDatabaseStorage();
    const feedMetadata = await feedStorage.getFeedById(feedId, project.workspaceId);
    
    if (!feedMetadata) {
      return res.status(404).json({ message: "Feed not found" });
    }

    // Get actual feed data based on type to calculate row count
    let rowCount = 0;
    try {
      if (feedMetadata.type === 'General Feed') {
        const data = await feedStorage.getFeedGeneralData(feedId, project.workspaceId);
        rowCount = data.length;
      } else if (feedMetadata.type === 'Product Feed') {
        const data = await feedStorage.getFeedProductData(feedId, project.workspaceId);
        rowCount = data.length;
      } else if (feedMetadata.type === 'Product Listing Page') {
        const data = await feedStorage.getFeedPlpData(feedId, project.workspaceId);
        rowCount = data.length;
      }
    } catch (error) {
      console.warn('Could not get feed data for row count:', error);
      rowCount = 0;
    }

    // Get workspace and user for storage path
    const workspace = await storage.getWorkspace(project.workspaceId, userId);
    const user = await storage.getUser(userId);
    
    if (!user || !workspace) {
      return res.status(404).json({ message: "User or workspace not found" });
    }

    // Generate storage reference for feed data (no actual file stored)
    const sheetName = `${sheetType}.xlsx`;
    const storageReference = `feed-reference/${feedId}/${sheetName}`;

    // Save metadata to database
    await storage.saveLHFInputSheetsData({
      workspaceId: project.workspaceId,
      projectId,
      sheetName,
      sheetType,
      sheetStorageReference: storageReference,
      rowCount,
      originalHeaders: parsedHeaders,
      mappingConfig: parsedMappingConfig
    });

    console.log('✅ LHF Feed input metadata saved successfully');

    res.json({ 
      success: true, 
      message: `${sheetType} feed data configured successfully`,
      storagePath: storageReference,
      rowCount,
      feedName
    });

  } catch (error: any) {
    console.error('❌ Error handling feed input:', error);
    res.status(500).json({ message: "Failed to process feed input" });
  }
}

export function createLowHangingFruitsRoutes(): Router {
  const router = Router();
  
  // Configure multer for file uploads
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit for large Excel files
  });

  router.get('/', requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      let currentWorkspaceId = req.session.currentWorkspaceId;

      if (req.query.workspaceId) {
        currentWorkspaceId = parseInt(req.query.workspaceId as string);
      }

      if (!currentWorkspaceId) {
        return res.json([]);
      }

      const workspace = await storage.getWorkspace(currentWorkspaceId, userId);
      if (!workspace) {
        return res.json([]);
      }

      const projects = await storage.getToolProjects('low-hanging-fruits', currentWorkspaceId);
      res.json(projects);
    } catch (error) {
      console.error('Error fetching low-hanging-fruits projects:', error);
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  router.post('/', requireAuth, async (req, res) => {
    try {
      const { name, workspaceId } = req.body;

      if (!name || !workspaceId) {
        return res.status(400).json({ message: "Name and workspaceId are required" });
      }

      const userId = req.session.userId!;
      const workspace = await storage.getWorkspace(workspaceId, userId);
      if (!workspace) {
        return res.status(404).json({ message: "Workspace not found or does not belong to user" });
      }

      const project = await storage.createToolProject('low-hanging-fruits', name, workspaceId, userId);
      res.status(201).json(project);
    } catch (error) {
      console.error('Error creating low-hanging-fruits project:', error);
      res.status(500).json({ message: "Failed to create project" });
    }
  });

  router.delete('/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid project ID" });
    }

    const success = await storage.deleteToolProject(id, 'low-hanging-fruits');
    if (!success) {
      return res.status(404).json({ message: "Project not found" });
    }

    res.json({ success: true });
  });

  // Input Sheets Routes

  // MIGRATION: NEW Object Storage Input Sheets Route
  router.get('/:projectId/input-sheets', requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      // Get sheets data from new lhf_input_sheets_data table
      const inputSheetsData = await storage.listLHFInputSheetsData(projectId);
      
      console.log('📊 LHF OBJECT STORAGE INPUT SHEETS:', inputSheetsData);
      
      // Transform to match frontend expectations
      const sheetsWithMappings = inputSheetsData.map(sheet => ({
        id: sheet.id,
        projectId: sheet.projectId,
        sheetName: sheet.sheetName,
        sheetType: sheet.sheetType,
        fileName: sheet.sheetName,
        rowCount: sheet.rowCount,
        originalHeaders: sheet.originalHeaders,
        uploadedAt: sheet.uploadedAt,
        columnMappings: sheet.mappingConfig, // Mapping config stored directly in new table
        storageReference: sheet.sheetStorageReference
      }));

      console.log('✅ LHF Object Storage sheets transformed:', sheetsWithMappings.length);
      res.json({ data: sheetsWithMappings });
    } catch (error: any) {
      console.error('❌ Error fetching Object Storage input sheets:', error);
      res.status(500).json({ message: "Failed to fetch input sheets" });
    }
  });

  // MIGRATION: NEW Object Storage Upload Route (with multer for original file preservation)
  router.post('/:projectId/input-sheets/:sheetType', requireAuth, upload.single('file'), async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      const sheetType = req.params.sheetType;
      
      console.log('🔄 LHF OBJECT STORAGE UPLOAD:', { projectId, sheetType, hasFile: !!req.file, bodyKeys: Object.keys(req.body) });
      
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      if (!['gsc_data', 'product_feed', 'plp_feed'].includes(sheetType)) {
        return res.status(400).json({ message: "Invalid sheet type" });
      }

      const { fileName: reqFileName, originalHeaders: reqOriginalHeaders, mappingConfig: reqMappingConfig, inputMethod, feedId, feedName } = req.body;
      
      // Handle feed-based input (no file upload required)
      if (inputMethod === 'feed') {
        return handleFeedBasedInput({
          projectId,
          sheetType,
          feedId: parseInt(feedId),
          feedName,
          fileName: reqFileName,
          originalHeaders: reqOriginalHeaders,
          mappingConfig: reqMappingConfig,
          storage,
          userId: req.session.userId!,
          res
        });
      }

      // Handle file-based input (requires file upload)
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { fileName: fileReqFileName, originalHeaders: fileReqOriginalHeaders, mappingConfig: fileReqMappingConfig, inputMethod: fileInputMethod } = req.body;
      
      // Parse JSON strings from FormData
      const parsedHeaders = JSON.parse(fileReqOriginalHeaders || '[]');
      const parsedMappingConfig = JSON.parse(fileReqMappingConfig || '{}');

      console.log('🔍 LHF File validation:', { 
        hasFileName: !!fileReqFileName, 
        hasHeaders: !!parsedHeaders?.length, 
        hasMapping: !!Object.keys(parsedMappingConfig).length, 
        fileSize: req.file.size,
        fileOriginalName: req.file.originalname
      });

      if (!fileReqFileName || !parsedHeaders || !parsedMappingConfig) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Get user workspace context for hierarchical Object Storage path
      const userId = req.session.userId!;
      const project = await storage.getLHFProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Use original file buffer (preserves file size and format)
      const originalFileBuffer = req.file.buffer;

      // Upload original file buffer to hierarchical Object Storage
      const sheetName = `${sheetType}.xlsx`;
      await ObjectStorageManager.uploadLHFInputSheetLegacy(projectId, sheetName, originalFileBuffer);

      console.log('✅ LHF Object Storage upload successful:', sheetName);

      // Parse data from original file to get row count for metadata
      const workbook = XLSX.read(originalFileBuffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      const rowCount = jsonData.length;

      // Save metadata to lhf_input_sheets_data table
      const workspace = await storage.getWorkspace(project.workspaceId, userId);
      const user = await storage.getUser(userId);
      
      if (!user || !workspace) {
        return res.status(404).json({ message: "User or workspace not found" });
      }

      // Generate proper hierarchical Object Storage path matching AE & CB tools
      const properStorageReference = ObjectStorageManager.generateLHFInputSheetPath(
        user.email,
        workspace.name,
        workspace.id,
        projectId,
        sheetName
      );

      await storage.saveLHFInputSheetsData({
        workspaceId: project.workspaceId,
        projectId,
        sheetName,
        sheetType,
        sheetStorageReference: properStorageReference,
        rowCount,
        originalHeaders: parsedHeaders,
        mappingConfig: parsedMappingConfig
      });

      console.log('✅ LHF Database metadata saved successfully');

      res.json({ 
        success: true, 
        message: `${sheetType} data saved to Object Storage successfully`,
        storagePath: `hierarchical/${projectId}/${sheetName}`,
        rowCount,
        fileSize: req.file.size
      });
    } catch (error: any) {
      const projectId = parseInt(req.params.projectId);
      const sheetType = req.params.sheetType;
      console.error('❌ LHF OBJECT STORAGE SAVE ERROR:', {
        error: error?.message,
        stack: error?.stack,
        projectId,
        sheetType
      });
      res.status(500).json({ 
        message: "Failed to save input sheet to Object Storage", 
        error: error?.message || 'Unknown error'
      });
    }
  });

  // MIGRATION: NEW Object Storage Delete Sheet Route
  router.delete('/:projectId/input-sheets/:sheetType', requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      const sheetType = req.params.sheetType;

      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      // Delete from Object Storage
      const sheetName = `${sheetType}.xlsx`;
      await ObjectStorageManager.deleteLHFInputSheetLegacy(projectId, sheetName);

      // Delete metadata from lhf_input_sheets_data table - only the specific sheet type
      const sheetData = await storage.getLHFInputSheetsData(projectId, sheetType);
      if (sheetData) {
        await storage.deleteLHFInputSheetByType(projectId, sheetType);
      }

      console.log('✅ LHF Object Storage sheet deleted:', sheetName);
      res.json({ success: true });
    } catch (error: any) {
      console.error('❌ Error deleting Object Storage input sheet:', error);
      res.status(500).json({ message: "Failed to delete input sheet" });
    }
  });

  // MIGRATION: NEW Object Storage Delete All Sheets Route
  router.delete('/:projectId/input-sheets', requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      // Clear all Object Storage files for project
      await ObjectStorageManager.clearLHFInputSheetsLegacy(projectId);

      // Clear all metadata from lhf_input_sheets_data table
      await storage.clearLHFInputSheetsData(projectId);

      console.log('✅ LHF All Object Storage sheets cleared for project:', projectId);
      res.json({ success: true });
    } catch (error: any) {
      console.error('❌ Error deleting all Object Storage input sheets:', error);
      res.status(500).json({ message: "Failed to delete all input sheets" });
    }
  });

  // Processing Routes - Phase 2 Implementation

  // Global processor instance
  const processor = new LowHangingFruitsProcessor(storage);

  // Start processing
  router.post('/:projectId/start-processing', requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      if (processor.isCurrentlyProcessing()) {
        return res.status(400).json({ message: "Processing is already in progress" });
      }

      // Update database status to processing before starting
      try {
        await storage.updateProject(projectId, 0, { status: 'processing' });
        console.log(`✅ LHF: Updated project ${projectId} status to processing`);
      } catch (dbError) {
        console.error(`❌ LHF: Failed to update database status for project ${projectId}:`, dbError);
      }

      // Start processing without blocking the response
      const processingPromise = processor.startProcessing({ projectId });
      
      // Don't await the processing - let it run in background
      processingPromise.catch(error => {
        console.error('LHF Processing error:', error);
      });

      res.json({ 
        success: true, 
        message: "Processing started",
        projectId 
      });
    } catch (error) {
      console.error('Error starting LHF processing:', error);
      res.status(500).json({ message: "Failed to start processing" });
    }
  });

  // Get processing status - enhanced with page refresh completion detection
  router.get('/:projectId/processing-status', async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      // First check in-memory processor status for active processing
      if (processor.isCurrentlyProcessing()) {
        const status = processor.getProcessingStatus();
        console.log(`🔄 LHF STATUS: Project ${projectId} - active processing detected`);
        return res.json({
          ...status,
          projectId,
          isComplete: false,
          currentPhase: status.status,
          phaseStatus: status.status,
          isProcessing: processor.isCurrentlyProcessing(),
          isPaused: false,
          processingId: null,
          lastChecked: new Date().toISOString()
        });
      }

      // Check for completion by prioritizing Object Storage results (like Link Boosting Products)
      const resultsExist = await ObjectStorageManager.checkExcelFileExistsLegacy('low-hanging-fruits', projectId);
      console.log(`📄 LHF STATUS: Project ${projectId} Object Storage results exist: ${resultsExist.exists}`);
      
      if (resultsExist.exists) {
        console.log(`✅ LHF STATUS: Project ${projectId} is COMPLETED - found results in Object Storage`);
        
        // Return completion status structure that frontend expects
        return res.json({
          projectId,
          progress: 100,
          status: 'completed',
          isComplete: true,
          currentPhase: 'completed',
          phaseStatus: 'completed',
          isProcessing: false,
          isPaused: false,
          message: 'Low hanging fruit analysis completed successfully',
          processingId: null,
          logs: [],
          lastChecked: new Date().toISOString()
        });
      }

      // Check database status for other states
      try {
        const project = await storage.getProject(projectId, 0);
        console.log(`🔍 LHF STATUS: Project ${projectId} database status: ${project?.status}`);

        // Return appropriate status for non-completed projects
        const status = processor.getProcessingStatus();
        const currentPhase = project?.status === 'processing' ? 'processing' : 'not_started';
        
        console.log(`🔄 LHF STATUS: Project ${projectId} status: ${project?.status} - phase: ${currentPhase}`);
        
        return res.json({
          projectId,
          progress: status.progress || 0,
          status: status.status || 'idle',
          isComplete: false,
          currentPhase,
          phaseStatus: currentPhase,
          isProcessing: project?.status === 'processing',
          isPaused: false,
          message: project?.status === 'processing' ? 'Processing in progress...' : 'Ready to start analysis',
          processingId: null,
          databaseStatus: project?.status || 'active',
          logs: status.logs || [],
          lastChecked: new Date().toISOString()
        });

      } catch (dbError) {
        console.log(`❌ LHF STATUS: Database error for project ${projectId}:`, dbError);
        // Fallback to basic processor status
        const status = processor.getProcessingStatus();
        return res.json({
          ...status,
          projectId,
          isComplete: false,
          currentPhase: status.status || 'not_started',
          phaseStatus: status.status || 'not_started',
          isProcessing: processor.isCurrentlyProcessing(),
          isPaused: false,
          processingId: null,
          lastChecked: new Date().toISOString()
        });
      }

    } catch (error) {
      console.error('❌ LHF STATUS: Error getting processing status:', error);
      res.status(500).json({ message: "Failed to get processing status" });
    }
  });

  // Stop processing
  router.post('/:projectId/stop-processing', requireAuth, async (req, res) => {
    try {
      processor.stopProcessing();
      res.json({ success: true, message: "Processing stopped" });
    } catch (error) {
      console.error('Error stopping processing:', error);
      res.status(500).json({ message: "Failed to stop processing" });
    }
  });

  // Check if results exist for a project
  router.get('/:projectId/results-exist', async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      const metadata = await ObjectStorageManager.checkExcelFileExistsLegacy('low-hanging-fruits', projectId);
      
      res.json({ 
        exists: metadata.exists,
        ...(metadata.exists && { 
          file: {
            fileName: metadata.fileName,
            size: metadata.size,
            message: metadata.message
          }
        })
      });
    } catch (error) {
      console.error('Error checking results existence:', error);
      res.status(500).json({ message: "Failed to check results" });
    }
  });

  // Clear all results and processing data for a project
  router.delete('/:projectId/clear-results', requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      console.log(`🧹 Starting clear results for project ${projectId}`);

      // Stop any ongoing processing
      if (processor.isCurrentlyProcessing()) {
        processor.stopProcessing();
        console.log(`⏹️ Stopped ongoing processing for project ${projectId}`);
      }

      // Check if file exists before deletion
      const fileExists = await ObjectStorageManager.checkExcelFileExistsLegacy('low-hanging-fruits', projectId);
      console.log(`📋 File existence check for project ${projectId}:`, fileExists);

      // Delete Excel results file from Object Storage
      try {
        await ObjectStorageManager.clearProjectFilesLegacy('low-hanging-fruits', projectId);
        console.log(`✅ Cleared results from Object Storage for project ${projectId}`);
      } catch (objStorageError) {
        console.error(`❌ Object Storage deletion failed for project ${projectId}:`, objStorageError);
        // Continue with database clearing even if Object Storage fails
      }

      // Clear all database results
      await storage.clearLHFProcessingResults(projectId);
      console.log(`🗄️ Cleared database results for project ${projectId}`);

      // Verify deletion
      const afterClear = await ObjectStorageManager.checkExcelFileExistsLegacy('low-hanging-fruits', projectId);
      console.log(`🔍 File existence after clear for project ${projectId}:`, afterClear);

      res.json({ 
        success: true, 
        message: "All results and processing data cleared successfully" 
      });
    } catch (error) {
      console.error('Error clearing results:', error);
      res.status(500).json({ message: "Failed to clear results" });
    }
  });

  // Download results Excel file
  router.get('/:projectId/download-excel', requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      const buffer = await ObjectStorageManager.downloadExcelFileLegacy('low-hanging-fruits', projectId);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Low_Hanging_Fruits_Results_${projectId}.xlsx"`);
      res.setHeader('Content-Length', buffer.length.toString());
      
      res.send(buffer);
    } catch (error: any) {
      console.error('Error downloading Excel file:', error);
      if (error?.message && error.message.includes('not found')) {
        res.status(404).json({ message: "Results file not found. Please run processing first." });
      } else {
        res.status(500).json({ message: "Failed to download results file" });
      }
    }
  });

  // Save to Feeds route - NEW FEATURE
  router.post('/:projectId/save-to-feeds', requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      const { feedName, saveProducts, saveCategories, productsType, categoriesType } = req.body;

      // Validation
      if (!feedName || (!saveProducts && !saveCategories)) {
        return res.status(400).json({ 
          message: "Feed name is required and at least one output type must be selected" 
        });
      }

      const userId = req.session.userId!;
      const workspaceId = req.session.currentWorkspaceId!;

      // Initialize feed storage instance
      const feedStorage = new FeedDatabaseStorage();

      // Check if workspace exists
      const workspace = await storage.getWorkspace(workspaceId, userId);
      if (!workspace) {
        return res.status(404).json({ message: "Workspace not found" });
      }

      // Check if results file exists in Object Storage
      const metadata = await ObjectStorageManager.checkExcelFileExistsLegacy('low-hanging-fruits', projectId);
      if (!metadata.exists) {
        return res.status(404).json({ message: "Results file not found. Please run processing first." });
      }

      // Download and parse Excel file from Object Storage
      const buffer = await ObjectStorageManager.downloadExcelFileLegacy('low-hanging-fruits', projectId);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      
      const createdFeeds = [];

      // Process Products Output if selected
      if (saveProducts && workbook.SheetNames.includes('Products_Output_Completed')) {
        const productsSheet = XLSX.utils.sheet_to_json(workbook.Sheets['Products_Output_Completed']);
        
        if (productsSheet.length > 0) {
          // Create products feed
          const productsFeedName = saveCategories ? `${feedName} - Products` : feedName;
          const productsFeed = await feedStorage.createFeed({
            name: productsFeedName,
            workspaceId,
            type: productsType,
            fileName: `${productsFeedName}.xlsx`,
            status: 'active'
          });

          // Convert products data to feed format
          const productsData = productsSheet.map((row: any) => {
            const dynamicColumns: any = {};
            const excludedFields = [
              'name', 'urlSlug', 'recordId', 'description', 'productLink', 'productImage', 'productAttributes',
              'Name', 'URL Slug', 'RecordId', 'Description', 'Product Link', 'Product Image', 'Product Attributes'
            ];
            Object.keys(row).forEach(key => {
              if (!excludedFields.includes(key)) {
                dynamicColumns[key] = row[key];
              }
            });

            return {
              feedId: productsFeed.id,
              workspaceId,
              productName: row.name || row.Name || '',
              productId: row.recordId || row.RecordId || '',
              description: row.description || row.Description || '',
              productLink: row.productLink || row['Product Link'] || '',
              productImage: row.productImage || row['Product Image'] || '',
              productAttributes: row.productAttributes || row['Product Attributes'] || '',
              dynamicColumns,
              originalRowData: row
            };
          });

          if (productsType === 'Product Feed') {
            await feedStorage.saveFeedProductData(productsData);
          } else {
            // General Feed
            const generalData = productsData.map(item => ({
              feedId: item.feedId,
              workspaceId,
              dynamicColumns: {
                productName: item.productName,
                productId: item.productId,
                description: item.description,
                productLink: item.productLink,
                productImage: item.productImage,
                productAttributes: item.productAttributes,
                ...item.dynamicColumns
              },
              originalRowData: item.originalRowData
            }));
            await feedStorage.saveFeedGeneralData(generalData);
          }

          createdFeeds.push({
            name: productsFeedName,
            type: productsType,
            recordCount: productsData.length
          });
        }
      }

      // Process Categories Output if selected
      if (saveCategories && workbook.SheetNames.includes('Categ_Output_Completed')) {
        const categoriesSheet = XLSX.utils.sheet_to_json(workbook.Sheets['Categ_Output_Completed']);
        
        if (categoriesSheet.length > 0) {
          // Create categories feed
          const categoriesFeedName = saveProducts ? `${feedName} - Categories` : feedName;
          const categoriesFeed = await feedStorage.createFeed({
            name: categoriesFeedName,
            workspaceId,
            type: categoriesType,
            fileName: `${categoriesFeedName}.xlsx`,
            status: 'active'
          });

          // Convert categories data to feed format
          const categoriesData = categoriesSheet.map((row: any) => {
            const dynamicColumns: any = {};
            Object.keys(row).forEach(key => {
              if (key !== 'name' && key !== 'urlSlug' && key !== 'pageType') {
                dynamicColumns[key] = row[key];
              }
            });

            return {
              feedId: categoriesFeed.id,
              workspaceId,
              categoryName: row.name || row.Name || '',
              urlPath: row.urlSlug || row['URL Slug'] || '',
              pageType: row.pageType || row['Page Type'] || 'category',
              dynamicColumns,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          });

          if (categoriesType === 'Product Listing Page') {
            await feedStorage.saveFeedPlpData(categoriesData);
          } else {
            // General Feed
            const generalData = categoriesData.map(item => ({
              feedId: item.feedId,
              workspaceId,
              dynamicColumns: {
                categoryName: item.categoryName,
                urlPath: item.urlPath,
                pageType: item.pageType,
                ...item.dynamicColumns
              },
              createdAt: item.createdAt,
              updatedAt: item.updatedAt
            }));
            await feedStorage.saveFeedGeneralData(generalData);
          }

          createdFeeds.push({
            name: categoriesFeedName,
            type: categoriesType,
            recordCount: categoriesData.length
          });
        }
      }

      res.json({
        success: true,
        message: `Successfully created ${createdFeeds.length} feed(s)`,
        feeds: createdFeeds
      });

    } catch (error: any) {
      console.error('Error saving to feeds:', error);
      res.status(500).json({ 
        message: "Failed to save to feeds", 
        error: error?.message || 'Unknown error'
      });
    }
  });

  // NEW OBJECT STORAGE ROUTES - Following the new architecture pattern

  // New route: GET /results/:projectId/download - Download from Object Storage
  router.get('/results/:projectId/download', requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      const buffer = await ObjectStorageManager.downloadExcelFileLegacy('low-hanging-fruits', projectId);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Low_Hanging_Fruits_Results_${projectId}.xlsx"`);
      res.setHeader('Content-Length', buffer.length.toString());
      
      res.send(buffer);
    } catch (error: any) {
      console.error('Error downloading Excel file from Object Storage:', error);
      if (error?.message && error.message.includes('not found')) {
        res.status(404).json({ message: "Results file not found. Please run processing first." });
      } else {
        res.status(500).json({ message: "Failed to download results file" });
      }
    }
  });

  // New route: GET /results/:projectId/status - Check status from Object Storage
  router.get('/results/:projectId/status', async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      const metadata = await ObjectStorageManager.checkExcelFileExistsLegacy('low-hanging-fruits', projectId);
      
      res.json({ 
        exists: metadata.exists,
        fileName: metadata.fileName,
        message: metadata.message,
        ...(metadata.exists && { 
          size: metadata.size
        })
      });
    } catch (error) {
      console.error('Error checking results status in Object Storage:', error);
      res.status(500).json({ message: "Failed to check results status" });
    }
  });



  return router;
}