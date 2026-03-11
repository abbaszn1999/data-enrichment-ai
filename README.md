# AI Product Data Enrichment Tool

A smart spreadsheet web application (SaaS MVP) that automatically enriches e-commerce product data using Google's Gemini AI. 

Like Clay.com, but specialized for e-commerce catalog teams.

## 🚀 Features

- **Excel/CSV Upload**: Drag and drop your raw product data.
- **Smart Spreadsheet UI**: View and manage your data in a beautiful, TanStack-powered data table.
- **Waterfall AI Enrichment**: 
  1. **Search Agent (Gemini 3 Flash)**: Automatically searches the web for the product using `google_search` grounding.
  2. **Writer Agent (Gemini 3.1 Pro)**: Processes the search results and generates structured marketing content.
- **Real-time Processing**: Rows update live as they are processed via Server-Sent Events (SSE).
- **Enrichment Columns**:
  - Enhanced SEO Title
  - Marketing Description
  - Key Features (Bullets)
  - Category Classification
  - SEO Keywords
  - Marketplace Bullets (Amazon/Noon style)
  - Source URLs (Citations from search)
- **Excel Export**: Download the enriched data back to your local machine.

## 🛠️ Tech Stack

- **Framework**: Next.js 15 (App Router, Server Actions)
- **Language**: TypeScript
- **UI & Styling**: React 19, Tailwind CSS v4, shadcn/ui, Lucide Icons
- **State Management**: Zustand
- **Table Component**: TanStack Table v8
- **Excel Parsing**: SheetJS (xlsx)
- **AI Models**: `@google/genai` SDK (`gemini-3-flash-preview` and `gemini-3.1-pro-preview`)

## 🚦 Getting Started

### Prerequisites

- Node.js 18+
- A Google Gemini API Key

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables:
   - Create a `.env` file in the root directory
   - Add your Gemini API key:
     ```env
     GEMINI_API_KEY=your_api_key_here
     ```

### Running the App

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 💡 How to Use

1. Prepare an Excel file (`.xlsx`) or CSV with your raw product data. It should ideally have columns like `SKU`, `Brand`, `Model`, `Price`, and a basic `Description`.
2. Upload the file on the main page.
3. Select which enrichment columns you want the AI to generate.
4. Click **"Enrich X Rows"**.
5. Watch as the AI searches the web and writes copy for each row in real-time.
6. Click **"Export Excel"** to download your enriched catalog.

## 📝 License

MIT
