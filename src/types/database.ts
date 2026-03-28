export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string;
          avatar_url?: string | null;
        };
        Update: {
          full_name?: string;
          avatar_url?: string | null;
          updated_at?: string;
        };
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string;
          logo_url: string | null;
          cms_type: string;
          owner_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          name: string;
          slug: string;
          description?: string;
          logo_url?: string | null;
          cms_type?: string;
          owner_id: string;
        };
        Update: {
          name?: string;
          description?: string;
          logo_url?: string | null;
          cms_type?: string;
          updated_at?: string;
        };
      };
      workspace_members: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          role: "owner" | "admin" | "editor" | "viewer";
          joined_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role?: "owner" | "admin" | "editor" | "viewer";
        };
        Update: {
          role?: "owner" | "admin" | "editor" | "viewer";
        };
      };
      workspace_invites: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          role: "admin" | "editor" | "viewer";
          invited_by: string;
          status: "pending" | "accepted" | "expired";
          created_at: string;
          expires_at: string;
        };
        Insert: {
          workspace_id: string;
          email: string;
          role?: "admin" | "editor" | "viewer";
          invited_by: string;
        };
        Update: {
          status?: "pending" | "accepted" | "expired";
        };
      };
      // NOTE: categories, master_products stored in Storage JSON (workspace-files bucket)
      // See: storage-helpers.ts → CategoryJson, MasterProductJson
      import_sessions: {
        Row: {
          id: string;
          workspace_id: string;
          file_id: string | null;
          supplier_id: string | null;
          name: string;
          notes: string;
          tags: string[];
          status: "matching" | "review" | "enriching" | "completed" | "cancelled";
          column_mapping: Json;
          supplier_match_column: string | null;
          master_match_column: string;
          target_category_ids: string[];
          matching_rules: Json;
          enrichment_columns: Json;
          enrichment_settings: Json;
          total_rows: number;
          existing_count: number;
          new_count: number;
          enriched_count: number;
          updated_count: number;
          storage_path: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          name: string;
          created_by: string;
          file_id?: string | null;
          supplier_id?: string | null;
          notes?: string;
          tags?: string[];
          total_rows?: number;
          column_mapping?: Json;
          supplier_match_column?: string | null;
          storage_path?: string | null;
        };
        Update: {
          status?: "matching" | "review" | "enriching" | "completed" | "cancelled";
          matching_rules?: Json;
          enrichment_columns?: Json;
          enrichment_settings?: Json;
          existing_count?: number;
          new_count?: number;
          enriched_count?: number;
          updated_count?: number;
          storage_path?: string | null;
          updated_at?: string;
        };
      };
      // NOTE: import_rows stored in Storage JSON (projects/{sessionId}.json)
      export_templates: {
        Row: {
          id: string;
          workspace_id: string | null;
          platform: string;
          name: string;
          description: string;
          file_format: "csv" | "xlsx" | "tsv";
          column_mapping: Json;
          is_system: boolean;
          created_at: string;
        };
        Insert: {
          workspace_id?: string | null;
          platform: string;
          name: string;
          description?: string;
          file_format?: "csv" | "xlsx" | "tsv";
          column_mapping?: Json;
          is_system?: boolean;
        };
        Update: {
          name?: string;
          description?: string;
          column_mapping?: Json;
        };
      };
      activity_log: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          details: Json;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          action: string;
          entity_type?: string | null;
          entity_id?: string | null;
          details?: Json;
        };
        Update: {};
      };
      subscription_plans: {
        Row: {
          id: string;
          name: string;
          display_name: string;
          description: string;
          max_workspaces: number | null;
          max_members_per_workspace: number | null;
          max_products_per_workspace: number | null;
          max_imports_per_month: number | null;
          max_storage_bytes: number | null;
          monthly_ai_credits: number;
          price_monthly: number;
          price_yearly: number;
          currency: string;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          name: string;
          display_name: string;
          description?: string;
          monthly_ai_credits?: number;
          price_monthly?: number;
          price_yearly?: number;
        };
        Update: {
          display_name?: string;
          description?: string;
          monthly_ai_credits?: number;
          price_monthly?: number;
          price_yearly?: number;
          is_active?: boolean;
        };
      };
      workspace_subscriptions: {
        Row: {
          id: string;
          workspace_id: string;
          plan_id: string;
          billing_cycle: "monthly" | "yearly" | "lifetime";
          status: "active" | "trialing" | "past_due" | "cancelled" | "expired";
          current_period_start: string;
          current_period_end: string | null;
          trial_end: string | null;
          cancelled_at: string | null;
          credits_used: number;
          credits_reset_at: string;
          external_subscription_id: string | null;
          external_customer_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          plan_id: string;
          billing_cycle?: "monthly" | "yearly" | "lifetime";
        };
        Update: {
          plan_id?: string;
          status?: "active" | "trialing" | "past_due" | "cancelled" | "expired";
          credits_used?: number;
          credits_reset_at?: string;
          updated_at?: string;
        };
      };
      credit_transactions: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          operation: "ai_enrichment" | "ai_image_search" | "ai_column_mapping" | "ai_category_suggest" | "credit_topup" | "monthly_reset";
          credits_used: number;
          entity_type: string | null;
          entity_id: string | null;
          details: Json;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          operation: "ai_enrichment" | "ai_image_search" | "ai_column_mapping" | "ai_category_suggest" | "credit_topup" | "monthly_reset";
          credits_used?: number;
          entity_type?: string | null;
          entity_id?: string | null;
          details?: Json;
        };
        Update: {};
      };
    };
  };
}
