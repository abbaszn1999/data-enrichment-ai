// ═══════════════════════════════════════════════════════════════
// MOCK DATA — All fake data for the demo prototype
// This entire /demo folder will be deleted after client review
// ═══════════════════════════════════════════════════════════════

export const mockUser = {
  id: "u-1",
  email: "admin@techstore.com",
  fullName: "Ahmed Al-Rashid",
  avatarUrl: null,
  createdAt: "2025-01-15T10:00:00Z",
};

export const mockTeamMembers = [
  { id: "u-1", fullName: "Ahmed Al-Rashid", email: "admin@techstore.com", role: "owner" as const, joinedAt: "2025-01-15T10:00:00Z" },
  { id: "u-2", fullName: "Sara Hassan", email: "sara@techstore.com", role: "admin" as const, joinedAt: "2025-02-01T10:00:00Z" },
  { id: "u-3", fullName: "Omar Khalil", email: "omar@techstore.com", role: "editor" as const, joinedAt: "2025-03-10T10:00:00Z" },
  { id: "u-4", fullName: "Lina Nasser", email: "lina@techstore.com", role: "viewer" as const, joinedAt: "2025-04-20T10:00:00Z" },
];

export const mockPendingInvites = [
  { id: "inv-1", email: "khalid@techstore.com", role: "editor" as const, createdAt: "2025-06-10T10:00:00Z", expiresAt: "2025-06-17T10:00:00Z" },
];

export const mockWorkspaces = [
  {
    id: "ws-1",
    name: "TechStore Electronics",
    slug: "techstore-electronics",
    description: "Main electronics store product management",
    logoUrl: null,
    ownerId: "u-1",
    memberCount: 4,
    productCount: 1247,
    categoryCount: 18,
    createdAt: "2025-01-15T10:00:00Z",
  },
  {
    id: "ws-2",
    name: "HomeGoods Shop",
    slug: "homegoods-shop",
    description: "Home & kitchen products",
    logoUrl: null,
    ownerId: "u-1",
    memberCount: 2,
    productCount: 523,
    categoryCount: 8,
    createdAt: "2025-03-20T10:00:00Z",
  },
];

export const mockCategories = [
  { id: "cat-1", name: "Electronics", slug: "electronics", parentId: null, productCount: 450, children: [
    { id: "cat-2", name: "Laptops", slug: "laptops", parentId: "cat-1", productCount: 120, children: [
      { id: "cat-5", name: "Gaming Laptops", slug: "gaming-laptops", parentId: "cat-2", productCount: 45, children: [] },
      { id: "cat-6", name: "Business Laptops", slug: "business-laptops", parentId: "cat-2", productCount: 75, children: [] },
    ]},
    { id: "cat-3", name: "Smartphones", slug: "smartphones", parentId: "cat-1", productCount: 200, children: [
      { id: "cat-7", name: "Android Phones", slug: "android-phones", parentId: "cat-3", productCount: 130, children: [] },
      { id: "cat-8", name: "iPhones", slug: "iphones", parentId: "cat-3", productCount: 70, children: [] },
    ]},
    { id: "cat-4", name: "Tablets", slug: "tablets", parentId: "cat-1", productCount: 80, children: [] },
  ]},
  { id: "cat-9", name: "Accessories", slug: "accessories", parentId: null, productCount: 350, children: [
    { id: "cat-10", name: "Cases & Covers", slug: "cases-covers", parentId: "cat-9", productCount: 150, children: [] },
    { id: "cat-11", name: "Chargers & Cables", slug: "chargers-cables", parentId: "cat-9", productCount: 120, children: [] },
    { id: "cat-12", name: "Audio", slug: "audio", parentId: "cat-9", productCount: 80, children: [] },
  ]},
  { id: "cat-13", name: "Personal Care", slug: "personal-care", parentId: null, productCount: 180, children: [
    { id: "cat-14", name: "Hair Care", slug: "hair-care", parentId: "cat-13", productCount: 90, children: [] },
    { id: "cat-15", name: "Skincare", slug: "skincare", parentId: "cat-13", productCount: 90, children: [] },
  ]},
];

export const mockMasterProducts = [
  { id: "mp-1", sku: "LP-DELL-5520", category: "Laptops", name: "Dell Latitude 5520", price: "1,299.00", stock: "45", brand: "Dell", status: "active" as const },
  { id: "mp-2", sku: "LP-HP-840G9", category: "Business Laptops", name: "HP EliteBook 840 G9", price: "1,450.00", stock: "32", brand: "HP", status: "active" as const },
  { id: "mp-3", sku: "LP-LEN-X1C10", category: "Business Laptops", name: "Lenovo ThinkPad X1 Carbon Gen 10", price: "1,899.00", stock: "18", brand: "Lenovo", status: "active" as const },
  { id: "mp-4", sku: "PH-SAM-S24U", category: "Android Phones", name: "Samsung Galaxy S24 Ultra", price: "1,199.00", stock: "67", brand: "Samsung", status: "active" as const },
  { id: "mp-5", sku: "PH-IPH-15PM", category: "iPhones", name: "iPhone 15 Pro Max 256GB", price: "1,399.00", stock: "23", brand: "Apple", status: "active" as const },
  { id: "mp-6", sku: "TB-IPD-AIR5", category: "Tablets", name: "iPad Air 5th Gen", price: "599.00", stock: "55", brand: "Apple", status: "active" as const },
  { id: "mp-7", sku: "AC-ANK-PD65W", category: "Chargers & Cables", name: "Anker 65W USB-C Charger", price: "35.99", stock: "200", brand: "Anker", status: "active" as const },
  { id: "mp-8", sku: "AC-APP-AIRPMAX", category: "Audio", name: "AirPods Max", price: "549.00", stock: "12", brand: "Apple", status: "active" as const },
  { id: "mp-9", sku: "PC-DYS-AIRWRAP", category: "Hair Care", name: "Dyson Airwrap Complete", price: "599.00", stock: "8", brand: "Dyson", status: "active" as const },
  { id: "mp-10", sku: "LP-ASUS-ROG16", category: "Gaming Laptops", name: "ASUS ROG Strix G16", price: "1,799.00", stock: "15", brand: "ASUS", status: "active" as const },
  { id: "mp-11", sku: "PH-PIX-8PRO", category: "Android Phones", name: "Google Pixel 8 Pro", price: "999.00", stock: "40", brand: "Google", status: "active" as const },
  { id: "mp-12", sku: "AC-SAM-BUDS3", category: "Audio", name: "Samsung Galaxy Buds3 Pro", price: "249.99", stock: "85", brand: "Samsung", status: "archived" as const },
];

// Supplier import demo data
export const mockSupplierColumns = [
  "Part Number", "Item Description", "Unit Cost", "QTY Available", "Brand Name", "Weight (kg)"
];

export const mockSupplierRows = [
  { "Part Number": "00LP-DELL-5520", "Item Description": "Dell Lat 5520 15.6in i7 16GB", "Unit Cost": "1150.00", "QTY Available": "60", "Brand Name": "Dell", "Weight (kg)": "1.8" },
  { "Part Number": "00LP-HP-840G9", "Item Description": "HP EliteBook 840 G9 14in i5", "Unit Cost": "1280.00", "QTY Available": "45", "Brand Name": "HP", "Weight (kg)": "1.4" },
  { "Part Number": "00PH-SAM-S24U", "Item Description": "Galaxy S24 Ultra 512GB Titanium", "Unit Cost": "1050.00", "QTY Available": "100", "Brand Name": "Samsung", "Weight (kg)": "0.23" },
  { "Part Number": "LP-MSI-RAID17", "Item Description": "MSI Raider GE78 17in RTX4090", "Unit Cost": "2800.00", "QTY Available": "10", "Brand Name": "MSI", "Weight (kg)": "3.1" },
  { "Part Number": "PH-ONE-12PRO", "Item Description": "OnePlus 12 Pro 256GB", "Unit Cost": "750.00", "QTY Available": "80", "Brand Name": "OnePlus", "Weight (kg)": "0.22" },
  { "Part Number": "00AC-ANK-PD65W", "Item Description": "Anker Nano II 65W GaN Charger", "Unit Cost": "28.00", "QTY Available": "500", "Brand Name": "Anker", "Weight (kg)": "0.12" },
  { "Part Number": "TB-SAM-S9FE", "Item Description": "Samsung Galaxy Tab S9 FE 128GB", "Unit Cost": "380.00", "QTY Available": "70", "Brand Name": "Samsung", "Weight (kg)": "0.52" },
  { "Part Number": "AC-JBL-FLIP6", "Item Description": "JBL Flip 6 Portable Speaker", "Unit Cost": "95.00", "QTY Available": "150", "Brand Name": "JBL", "Weight (kg)": "0.55" },
];

export const mockColumnMapping = {
  "Part Number": "sku",
  "Item Description": "name",
  "Unit Cost": "price",
  "QTY Available": "stock",
  "Brand Name": "brand",
  "Weight (kg)": "weight",
};

export interface MockMatchingRule {
  type: string;
  enabled: boolean;
  label: string;
  description: string;
  value: string;
  pattern: string;
}

export const mockMatchingRules: MockMatchingRule[] = [
  { type: "trim_whitespace", enabled: true, label: "Trim Whitespace", description: "Remove leading/trailing spaces", value: "", pattern: "" },
  { type: "case_insensitive", enabled: true, label: "Case Insensitive", description: "Compare as lowercase", value: "", pattern: "" },
  { type: "ignore_prefix", enabled: true, label: "Ignore Prefix", description: "Remove prefix from SKU", value: "00", pattern: "" },
  { type: "ignore_suffix", enabled: false, label: "Ignore Suffix", description: "Remove suffix from SKU", value: "", pattern: "" },
  { type: "strip_non_alnum", enabled: false, label: "Strip Non-Alphanumeric", description: "Remove dashes, slashes, etc.", value: "", pattern: "" },
  { type: "regex_extract", enabled: false, label: "Regex Extract", description: "Extract via regex pattern", value: "", pattern: "" },
  { type: "contains", enabled: false, label: "Contains Match", description: "Check if one contains the other", value: "", pattern: "" },
];

// After matching: 3 existing (update), 3 new, 2 in the middle
export const mockMatchResults = {
  existing: [
    { rowIndex: 0, supplierSku: "00LP-DELL-5520", normalizedSku: "LP-DELL-5520", matchedSku: "LP-DELL-5520", matchedProductId: "mp-1", confidence: 1.0,
      diff: { price: { old: "1,299.00", new: "1,150.00" }, stock: { old: "45", new: "60" } }
    },
    { rowIndex: 1, supplierSku: "00LP-HP-840G9", normalizedSku: "LP-HP-840G9", matchedSku: "LP-HP-840G9", matchedProductId: "mp-2", confidence: 1.0,
      diff: { price: { old: "1,450.00", new: "1,280.00" }, stock: { old: "32", new: "45" } }
    },
    { rowIndex: 2, supplierSku: "00PH-SAM-S24U", normalizedSku: "PH-SAM-S24U", matchedSku: "PH-SAM-S24U", matchedProductId: "mp-4", confidence: 1.0,
      diff: { price: { old: "1,199.00", new: "1,050.00" }, stock: { old: "67", new: "100" } }
    },
    { rowIndex: 5, supplierSku: "00AC-ANK-PD65W", normalizedSku: "AC-ANK-PD65W", matchedSku: "AC-ANK-PD65W", matchedProductId: "mp-7", confidence: 1.0,
      diff: { price: { old: "35.99", new: "28.00" }, stock: { old: "200", new: "500" } }
    },
  ],
  new: [
    { rowIndex: 3, supplierSku: "LP-MSI-RAID17", data: mockSupplierRows[3] },
    { rowIndex: 4, supplierSku: "PH-ONE-12PRO", data: mockSupplierRows[4] },
    { rowIndex: 6, supplierSku: "TB-SAM-S9FE", data: mockSupplierRows[6] },
    { rowIndex: 7, supplierSku: "AC-JBL-FLIP6", data: mockSupplierRows[7] },
  ],
};

export const mockImportSessions = [
  {
    id: "imp-1",
    name: "Samsung Q2 Shipment",
    supplier: "Samsung Electronics",
    status: "completed" as string,
    totalRows: 150,
    existingCount: 95,
    newCount: 55,
    enrichedCount: 55,
    createdAt: "2025-05-15T10:00:00Z",
    createdBy: "Ahmed Al-Rashid",
  },
  {
    id: "imp-2",
    name: "Dell Monthly Restock",
    supplier: "Dell Wholesale",
    status: "review" as string,
    totalRows: 80,
    existingCount: 60,
    newCount: 20,
    enrichedCount: 0,
    createdAt: "2025-06-01T10:00:00Z",
    createdBy: "Sara Hassan",
  },
  {
    id: "imp-3",
    name: "New Supplier - JBL Audio",
    supplier: "JBL Distribution",
    status: "mapping" as string,
    totalRows: 45,
    existingCount: 0,
    newCount: 0,
    enrichedCount: 0,
    createdAt: "2025-06-10T10:00:00Z",
    createdBy: "Omar Khalil",
  },
];

export const mockExportPlatforms = [
  { id: "shopify", name: "Shopify", format: "CSV", icon: "🛒", color: "bg-green-500" },
  { id: "woocommerce", name: "WooCommerce", format: "CSV", icon: "🔮", color: "bg-purple-500" },
  { id: "salla", name: "Salla (سلة)", format: "CSV", icon: "🏪", color: "bg-blue-500" },
  { id: "zid", name: "Zid (زد)", format: "XLSX", icon: "📦", color: "bg-indigo-500" },
  { id: "amazon", name: "Amazon", format: "TSV", icon: "📊", color: "bg-orange-500" },
  { id: "noon", name: "Noon", format: "XLSX", icon: "🌙", color: "bg-yellow-500" },
  { id: "generic_csv", name: "Generic CSV", format: "CSV", icon: "📄", color: "bg-gray-500" },
  { id: "generic_xlsx", name: "Generic Excel", format: "XLSX", icon: "📗", color: "bg-emerald-500" },
];

export const mockActivityLog = [
  { id: "act-1", action: "export_generated", user: "Ahmed Al-Rashid", details: "Exported 150 products to Shopify", createdAt: "2025-06-10T14:30:00Z" },
  { id: "act-2", action: "enrichment_completed", user: "Sara Hassan", details: "AI enrichment completed: 55 products", createdAt: "2025-06-10T12:00:00Z" },
  { id: "act-3", action: "import_completed", user: "Sara Hassan", details: "Import session 'Samsung Q2' completed", createdAt: "2025-06-10T11:00:00Z" },
  { id: "act-4", action: "products_updated", user: "Ahmed Al-Rashid", details: "Updated 95 products from Samsung shipment", createdAt: "2025-06-09T16:00:00Z" },
  { id: "act-5", action: "file_uploaded", user: "Omar Khalil", details: "Uploaded 'jbl_products_june.xlsx'", createdAt: "2025-06-09T10:00:00Z" },
  { id: "act-6", action: "member_invited", user: "Ahmed Al-Rashid", details: "Invited khalid@techstore.com as Editor", createdAt: "2025-06-08T09:00:00Z" },
  { id: "act-7", action: "category_created", user: "Ahmed Al-Rashid", details: "Created category 'Smart Home'", createdAt: "2025-06-07T15:00:00Z" },
  { id: "act-8", action: "products_imported", user: "Sara Hassan", details: "Imported 200 master products from Excel", createdAt: "2025-06-05T10:00:00Z" },
];

export const mockDashboardStats = {
  totalProducts: 1247,
  totalCategories: 18,
  recentImports: 3,
  teamMembers: 4,
  enrichmentRate: 78,
  lastImport: "Samsung Q2 Shipment",
  lastImportDate: "2025-06-10",
};
