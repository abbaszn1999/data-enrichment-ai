/**
 * One-off generator for two demo worksheets used to try the Catalog
 * Intelligence import flow: 30 real, well-known products and 30 real,
 * well-known store category (PLP) pages.
 *
 * Run: node scripts/generate-sample-sheets.cjs
 * Output: public/samples/sample-products.xlsx, public/samples/sample-categories.xlsx
 */
const path = require("path");
const XLSX = require("xlsx");

// Real, well-known consumer products with accurate brand/category pairing
// and realistic current retail prices (USD).
const PRODUCTS = [
  ["APL-IP15-128-BLK", "Apple iPhone 15 128GB", "Apple", "Smartphones", 799.0, "USD", "6.1-inch Super Retina XDR display, A16 Bionic chip, 48MP main camera, USB-C."],
  ["APL-IP15P-256-BLU", "Apple iPhone 15 Pro 256GB", "Apple", "Smartphones", 1099.0, "USD", "Titanium design, A17 Pro chip, 48MP Pro camera system, Action button."],
  ["SAM-S24-128-ONX", "Samsung Galaxy S24 128GB", "Samsung", "Smartphones", 799.99, "USD", "6.2-inch Dynamic AMOLED 2X, Snapdragon 8 Gen 3, Galaxy AI features."],
  ["SAM-S24U-256-TIT", "Samsung Galaxy S24 Ultra 256GB", "Samsung", "Smartphones", 1299.99, "USD", "6.8-inch QHD+ display, S Pen included, 200MP camera, titanium frame."],
  ["GGL-PXL8-128-OBS", "Google Pixel 8 128GB", "Google", "Smartphones", 699.0, "USD", "6.2-inch OLED display, Google Tensor G3, Magic Editor, 7 years of updates."],
  ["APL-MBA13-M2-256", "Apple MacBook Air 13-inch M2 256GB", "Apple", "Laptops", 1099.0, "USD", "Fanless M2 chip, 13.6-inch Liquid Retina display, up to 18 hours battery."],
  ["APL-MBP14-M3-512", "Apple MacBook Pro 14-inch M3 512GB", "Apple", "Laptops", 1599.0, "USD", "M3 chip, Liquid Retina XDR display, up to 22 hours battery life."],
  ["DEL-XPS13-I7-512", "Dell XPS 13 (Intel Core i7, 512GB)", "Dell", "Laptops", 999.0, "USD", "13.4-inch InfinityEdge display, premium aluminum build, Intel Evo platform."],
  ["LEN-TPX1C-G11", "Lenovo ThinkPad X1 Carbon Gen 11", "Lenovo", "Laptops", 1499.0, "USD", "14-inch business ultrabook, Intel Core i7, MIL-SPEC durability."],
  ["HP-SPX360-14", "HP Spectre x360 14", "HP", "Laptops", 1449.99, "USD", "2-in-1 convertible, 3K2K OLED touch display, Intel Core Ultra 7."],
  ["APL-IPADA-5-64", "Apple iPad Air 5th Gen 64GB", "Apple", "Tablets", 599.0, "USD", "10.9-inch Liquid Retina display, Apple M1 chip, USB-C, Apple Pencil support."],
  ["APL-IPADP11-M4-256", "Apple iPad Pro 11-inch M4 256GB", "Apple", "Tablets", 999.0, "USD", "Ultra Retina XDR display, M4 chip, Thunderbolt / USB 4 port."],
  ["SAM-TABS9-128", "Samsung Galaxy Tab S9 128GB", "Samsung", "Tablets", 799.99, "USD", "11-inch Dynamic AMOLED 2X, Snapdragon 8 Gen 2, S Pen included, IP68 rated."],
  ["SNY-WH1000XM5-BLK", "Sony WH-1000XM5 Wireless Headphones", "Sony", "Wireless Headphones", 399.99, "USD", "Industry-leading noise cancellation, 30-hour battery life, multipoint connection."],
  ["APL-AIRPP2-USBC", "Apple AirPods Pro (2nd Gen, USB-C)", "Apple", "Wireless Headphones", 249.0, "USD", "Active Noise Cancellation, Adaptive Audio, USB-C charging case."],
  ["BOS-QCU-BLK", "Bose QuietComfort Ultra Headphones", "Bose", "Wireless Headphones", 429.0, "USD", "Immersive Audio, world-class noise cancellation, up to 24-hour battery."],
  ["APL-AWS9-45-MID", "Apple Watch Series 9 45mm", "Apple", "Smart Watches", 429.0, "USD", "S9 SiP chip, Double Tap gesture, Always-On Retina display."],
  ["SAM-GWATCH6-44", "Samsung Galaxy Watch 6 44mm", "Samsung", "Smart Watches", 329.99, "USD", "Sapphire crystal glass, advanced sleep coaching, BioActive sensor."],
  ["SNY-PS5-SLIM", "Sony PlayStation 5 Slim (1TB)", "Sony", "Gaming Consoles", 499.0, "USD", "Custom AMD Zen 2 CPU, ray tracing, ultra-high-speed SSD, DualSense controller."],
  ["MSF-XBSX-1TB", "Microsoft Xbox Series X 1TB", "Microsoft", "Gaming Consoles", 499.0, "USD", "4K gaming at up to 120fps, 1TB custom SSD, Quick Resume."],
  ["NIN-SWOLED-WHT", "Nintendo Switch OLED Model", "Nintendo", "Gaming Consoles", 349.99, "USD", "7-inch OLED screen, enhanced audio, 64GB internal storage."],
  ["DYS-V15DET-GLD", "Dyson V15 Detect Cordless Vacuum", "Dyson", "Vacuum Cleaners", 749.99, "USD", "Laser dust detection, LCD screen showing particle counts, 60-min run time."],
  ["NES-VNEXT-GRY", "Nespresso Vertuo Next Coffee Machine", "Nespresso", "Coffee Makers", 159.0, "USD", "Centrifusion extraction technology, brews 5 cup sizes, compact design."],
  ["IPT-DUO7-6QT", "Instant Pot Duo 7-in-1 6 Quart", "Instant Pot", "Kitchen Appliances", 99.95, "USD", "Pressure cooker, slow cooker, rice cooker, steamer, and more in one."],
  ["NIN-AFMAX-XL", "Ninja Air Fryer Max XL", "Ninja", "Air Fryers", 149.99, "USD", "5.5-quart capacity, Max Crisp technology, wide temperature range."],
  ["KAI-ARTM5-EMP", "KitchenAid Artisan Stand Mixer 5 Quart", "KitchenAid", "Kitchen Appliances", 449.99, "USD", "325-watt motor, tilt-head design, 10 speeds, includes flat beater and whisk."],
  ["NKE-AM270-BLK-M", "Nike Air Max 270 Men's Shoes", "Nike", "Running Shoes", 150.0, "USD", "Large Max Air unit for all-day comfort, breathable mesh upper."],
  ["ADS-UB22-BLK-M", "Adidas Ultraboost 22 Running Shoes", "Adidas", "Running Shoes", 190.0, "USD", "Responsive BOOST midsole, Primeknit+ upper, Continental rubber outsole."],
  ["LEV-501-ORIG-32", "Levi's 501 Original Fit Jeans (32x32)", "Levi's", "Men's Jeans", 69.5, "USD", "Classic straight leg, button fly, 100% cotton denim, iconic fit since 1873."],
  ["TNF-THERMB-BLK-M", "The North Face ThermoBall Eco Jacket (Men's)", "The North Face", "Winter Jackets", 199.0, "USD", "Recycled synthetic insulation, packable warmth, water-repellent finish."],
];

const PRODUCT_HEADERS = [
  "SKU",
  "Product Name",
  "Brand",
  "Category",
  "Price",
  "Currency",
  "Description",
];

// Real, well-known store category / collection (PLP) pages with an
// accurate, typical taxonomy hierarchy.
const CATEGORIES = [
  ["Smartphones", "smartphones", "Electronics", "Shop the latest smartphones from top brands, including Apple, Samsung, and Google."],
  ["Laptops", "laptops", "Electronics", "Browse laptops for work, gaming, and everyday use from leading manufacturers."],
  ["Tablets", "tablets", "Electronics", "Discover tablets for reading, drawing, and productivity on the go."],
  ["Wireless Headphones", "wireless-headphones", "Audio", "Explore noise-cancelling and wireless headphones for every budget."],
  ["Smart Watches", "smart-watches", "Wearables", "Find smart watches that track fitness, health, and notifications."],
  ["Gaming Consoles", "gaming-consoles", "Electronics", "Shop the newest gaming consoles and bundles from Sony, Microsoft, and Nintendo."],
  ["TVs & Home Theater", "tvs-home-theater", "Electronics", "Upgrade your living room with TVs, soundbars, and home theater systems."],
  ["Cameras", "cameras", "Electronics", "Capture every moment with mirrorless, DSLR, and action cameras."],
  ["Home Audio", "home-audio", "Audio", "Speakers and audio systems for music lovers at home."],
  ["Computer Accessories", "computer-accessories", "Electronics", "Keyboards, mice, monitors, and other essential computer accessories."],
  ["Running Shoes", "running-shoes", "Shoes", "Performance running shoes for road, trail, and everyday training."],
  ["Men's Sneakers", "mens-sneakers", "Shoes", "Casual and athletic sneakers for men from the world's top brands."],
  ["Women's Sneakers", "womens-sneakers", "Shoes", "Trendy and comfortable sneakers designed for women."],
  ["Men's Jeans", "mens-jeans", "Clothing", "Classic and modern fits of men's denim jeans."],
  ["Women's Dresses", "womens-dresses", "Clothing", "Casual, work, and occasion dresses for every season."],
  ["Winter Jackets", "winter-jackets", "Clothing", "Stay warm with insulated and waterproof winter jackets."],
  ["Activewear", "activewear", "Clothing", "Performance apparel for running, yoga, and the gym."],
  ["Kitchen Appliances", "kitchen-appliances", "Home & Kitchen", "Essential appliances to equip a modern kitchen."],
  ["Coffee Makers", "coffee-makers", "Kitchen Appliances", "Drip machines, espresso makers, and single-serve coffee brewers."],
  ["Air Fryers", "air-fryers", "Kitchen Appliances", "Healthier frying with less oil using top-rated air fryers."],
  ["Vacuum Cleaners", "vacuum-cleaners", "Home & Kitchen", "Upright, cordless, and robot vacuums for every home."],
  ["Cookware Sets", "cookware-sets", "Home & Kitchen", "Pots, pans, and cookware sets for everyday cooking."],
  ["Bedding & Linens", "bedding-linens", "Home & Kitchen", "Sheets, comforters, and pillows for a better night's sleep."],
  ["Furniture", "furniture", "Home & Kitchen", "Sofas, tables, and storage furniture for every room."],
  ["Skincare", "skincare", "Beauty & Personal Care", "Cleansers, moisturizers, and serums for every skin type."],
  ["Haircare", "haircare", "Beauty & Personal Care", "Shampoos, conditioners, and styling products for healthy hair."],
  ["Fragrances", "fragrances", "Beauty & Personal Care", "Perfumes and colognes from designer and niche brands."],
  ["Toys & Games", "toys-games", "", "Toys, puzzles, and games for kids and families of all ages."],
  ["Pet Supplies", "pet-supplies", "", "Food, toys, and accessories for dogs, cats, and other pets."],
  ["Office Supplies", "office-supplies", "", "Stationery, organizers, and essentials for home and office."],
];

const CATEGORY_HEADERS = ["Name", "Slug", "Parent Category", "Description"];

function writeSheet(headers, rows, sheetName, outPath) {
  const worksheetData = [headers, ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  worksheet["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 18) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, outPath);
  console.log(`Wrote ${rows.length} rows -> ${outPath}`);
}

const outDir = path.join(__dirname, "..", "public", "samples");
writeSheet(PRODUCT_HEADERS, PRODUCTS, "Products", path.join(outDir, "sample-products.xlsx"));
writeSheet(CATEGORY_HEADERS, CATEGORIES, "Categories", path.join(outDir, "sample-categories.xlsx"));

if (PRODUCTS.length !== 30) throw new Error(`Expected 30 products, got ${PRODUCTS.length}`);
if (CATEGORIES.length !== 30) throw new Error(`Expected 30 categories, got ${CATEGORIES.length}`);
console.log("OK: both sheets have exactly 30 rows.");
