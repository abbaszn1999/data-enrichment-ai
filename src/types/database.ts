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
          collection_prefix: string;
          owner_id: string;
          catalog_revision: number;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          name: string;
          slug: string;
          description?: string;
          logo_url?: string | null;
          cms_type?: string;
          collection_prefix?: string;
          owner_id: string;
        };
        Update: {
          name?: string;
          description?: string;
          logo_url?: string | null;
          cms_type?: string;
          collection_prefix?: string;
          catalog_revision?: number;
          deleted_at?: string | null;
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
      workspace_integrations: {
        Row: {
          id: string;
          workspace_id: string;
          provider: "shopify" | "woocommerce" | "wordpress";
          integration_name: string;
          base_url: string;
          config: Json;
          credential_fingerprint: string | null;
          status: "connected";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          provider: "shopify" | "woocommerce" | "wordpress";
          integration_name: string;
          base_url: string;
          config?: Json;
          credential_fingerprint?: string | null;
          status?: "connected";
        };
        Update: {
          provider?: "shopify" | "woocommerce" | "wordpress";
          integration_name?: string;
          base_url?: string;
          config?: Json;
          credential_fingerprint?: string | null;
          status?: "connected";
          updated_at?: string;
        };
      };
      workspace_domains: {
        Row: {
          workspace_id: string;
          normalized_domain: string;
          source: string;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          normalized_domain: string;
          source?: string;
          created_at?: string;
        };
        Update: {
          workspace_id?: string;
          normalized_domain?: string;
          source?: string;
        };
      };
      // NOTE: categories remain Storage JSON. Master catalog rows dual-write
      // to workspace_products (Week 5) and products.json until other readers migrate.
      workspace_products: {
        Row: {
          workspace_id: string;
          sku: string;
          data: Json;
          meta: Json;
          search_text: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          sku: string;
          data?: Json;
          meta?: Json;
          search_text?: string;
          updated_at?: string;
        };
        Update: {
          data?: Json;
          meta?: Json;
          search_text?: string;
          updated_at?: string;
        };
      };
      workspace_product_columns: {
        Row: {
          workspace_id: string;
          columns: string[];
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          columns?: string[];
          updated_at?: string;
        };
        Update: {
          columns?: string[];
          updated_at?: string;
        };
      };
      catalog_sessions: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          notes: string;
          /** 'product' enriches catalog rows, 'plp' enriches category/listing pages. */
          kind: "product" | "plp";
          status: "matching" | "review" | "enriching" | "completed" | "cancelled";
          supplier_match_column: string | null;
          master_match_column: string;
          target_category_ids: string[];
          matching_rules: Json;
          total_rows: number;
          existing_count: number;
          new_count: number;
          enriched_count: number;
          storage_path: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          name: string;
          created_by: string;
          kind?: "product" | "plp";
          notes?: string;
          total_rows?: number;
          supplier_match_column?: string | null;
          storage_path?: string | null;
        };
        Update: {
          status?: "matching" | "review" | "enriching" | "completed" | "cancelled";
          matching_rules?: Json;
          supplier_match_column?: string | null;
          master_match_column?: string;
          target_category_ids?: string[];
          existing_count?: number;
          new_count?: number;
          enriched_count?: number;
          storage_path?: string | null;
          updated_at?: string;
        };
      };
      // Dual-write with projects/{sessionId}.json until other readers migrate.
      catalog_session_rows: {
        Row: {
          session_id: string;
          row_id: string;
          row_index: number;
          status: string;
          error_message: string | null;
          original_data: Json;
          enriched_data: Json;
          match_type: string | null;
          updated_at: string;
        };
        Insert: {
          session_id: string;
          row_id: string;
          row_index?: number;
          status?: string;
          error_message?: string | null;
          original_data?: Json;
          enriched_data?: Json;
          match_type?: string | null;
          updated_at?: string;
        };
        Update: {
          row_index?: number;
          status?: string;
          error_message?: string | null;
          original_data?: Json;
          enriched_data?: Json;
          match_type?: string | null;
          updated_at?: string;
        };
      };
      gallery_sessions: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          status: "draft" | "ready" | "processing" | "completed" | "failed";
          source_file_name: string;
          storage_path: string | null;
          images_prefix: string | null;
          total_rows: number;
          ready_rows: number;
          failed_rows: number;
          total_cost: number;
          total_credits: number;
          error_message: string | null;
          cancel_requested: boolean;
          worksheet_revision: number;
          settings: Json;
          settings_revision: number;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          name: string;
          created_by: string;
          status?: "draft" | "ready" | "processing" | "completed" | "failed";
          source_file_name?: string;
          storage_path?: string | null;
          images_prefix?: string | null;
          total_rows?: number;
          ready_rows?: number;
          failed_rows?: number;
          total_cost?: number;
          total_credits?: number;
          error_message?: string | null;
          cancel_requested?: boolean;
          worksheet_revision?: number;
          settings?: Json;
          settings_revision?: number;
        };
        Update: {
          name?: string;
          status?: "draft" | "ready" | "processing" | "completed" | "failed";
          source_file_name?: string;
          storage_path?: string | null;
          images_prefix?: string | null;
          total_rows?: number;
          ready_rows?: number;
          failed_rows?: number;
          total_cost?: number;
          total_credits?: number;
          error_message?: string | null;
          cancel_requested?: boolean;
          worksheet_revision?: number;
          settings?: Json;
          settings_revision?: number;
          updated_at?: string;
        };
      };
      gallery_session_rows: {
        Row: {
          session_id: string;
          row_id: string;
          row_index: number;
          status: string;
          data: Json;
          updated_at: string;
        };
        Insert: {
          session_id: string;
          row_id: string;
          row_index?: number;
          status?: string;
          data?: Json;
          updated_at?: string;
        };
        Update: {
          row_index?: number;
          status?: string;
          data?: Json;
          updated_at?: string;
        };
      };
      visualizer_session_rows: {
        Row: {
          session_id: string;
          row_id: string;
          row_index: number;
          status: string;
          data: Json;
          updated_at: string;
        };
        Insert: {
          session_id: string;
          row_id: string;
          row_index?: number;
          status?: string;
          data?: Json;
          updated_at?: string;
        };
        Update: {
          row_index?: number;
          status?: string;
          data?: Json;
          updated_at?: string;
        };
      };
      embed_page_cache: {
        Row: {
          workspace_id: string;
          domain: string;
          handle: string;
          payload: Json;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          domain: string;
          handle: string;
          payload?: Json;
          updated_at?: string;
        };
        Update: {
          payload?: Json;
          updated_at?: string;
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
          stripe_product_id: string | null;
          stripe_price_monthly_id: string | null;
          stripe_price_yearly_id: string | null;
          created_at: string;
        };
        Insert: {
          name: string;
          display_name: string;
          description?: string;
          monthly_ai_credits?: number;
          price_monthly?: number;
          price_yearly?: number;
          stripe_product_id?: string | null;
          stripe_price_monthly_id?: string | null;
          stripe_price_yearly_id?: string | null;
        };
        Update: {
          display_name?: string;
          description?: string;
          monthly_ai_credits?: number;
          price_monthly?: number;
          price_yearly?: number;
          is_active?: boolean;
          stripe_product_id?: string | null;
          stripe_price_monthly_id?: string | null;
          stripe_price_yearly_id?: string | null;
        };
      };
      user_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          plan_id: string;
          billing_cycle: "monthly" | "yearly";
          status: "active" | "trialing" | "past_due" | "cancelled" | "expired" | "incomplete";
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          current_period_start: string;
          current_period_end: string | null;
          trial_end: string | null;
          cancelled_at: string | null;
          cancel_at_period_end: boolean;
          credits_used: number;
          bonus_credits: number;
          credits_reset_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          plan_id: string;
          billing_cycle?: "monthly" | "yearly";
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
        };
        Update: {
          plan_id?: string;
          billing_cycle?: "monthly" | "yearly";
          status?: "active" | "trialing" | "past_due" | "cancelled" | "expired" | "incomplete";
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          current_period_start?: string;
          current_period_end?: string | null;
          trial_end?: string | null;
          cancelled_at?: string | null;
          cancel_at_period_end?: boolean;
          credits_used?: number;
          bonus_credits?: number;
          credits_reset_at?: string;
          updated_at?: string;
        };
      };
      credit_purchases: {
        Row: {
          id: string;
          user_id: string;
          credits: number;
          amount_paid: number;
          currency: string;
          stripe_checkout_session_id: string | null;
          stripe_payment_intent_id: string | null;
          status: "pending" | "completed" | "failed" | "refunded";
          created_at: string;
        };
        Insert: {
          user_id: string;
          credits: number;
          amount_paid: number;
          stripe_checkout_session_id?: string | null;
        };
        Update: {
          status?: "pending" | "completed" | "failed" | "refunded";
          stripe_payment_intent_id?: string | null;
        };
      };
      webhook_events: {
        Row: {
          id: string;
          type: string;
          processed_at: string;
          payload: Json;
        };
        Insert: {
          id: string;
          type: string;
          payload?: Json;
        };
        Update: {};
      };
      credit_transactions: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          operation: "catalog_intelligence" | "ai_image_search" | "ai_column_mapping" | "ai_category_suggest" | "ai_function" | "store_assistant" | "image_classification" | "gallery_google" | "gallery_ai" | "credit_topup" | "monthly_reset";
          credits_used: number;
          entity_type: string | null;
          entity_id: string | null;
          details: Json;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          operation: "catalog_intelligence" | "ai_image_search" | "ai_column_mapping" | "ai_category_suggest" | "ai_function" | "store_assistant" | "image_classification" | "gallery_google" | "gallery_ai" | "credit_topup" | "monthly_reset";
          credits_used?: number;
          entity_type?: string | null;
          entity_id?: string | null;
          details?: Json;
        };
        Update: {};
      };
      job_runs: {
        Row: {
          id: string;
          workspace_id: string;
          kind: "catalog" | "gallery" | "visualizer";
          session_id: string;
          created_by: string;
          status:
            | "queued"
            | "running"
            | "completed"
            | "failed"
            | "cancelled"
            | "paused_no_credits";
          target_ids: string[];
          completed_count: number;
          failed_count: number;
          heartbeat_at: string | null;
          cancel_requested: boolean;
          task_run_id: string | null;
          last_error: string | null;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          kind: "catalog" | "gallery" | "visualizer";
          session_id: string;
          created_by: string;
          status?:
            | "queued"
            | "running"
            | "completed"
            | "failed"
            | "cancelled"
            | "paused_no_credits";
          target_ids?: string[];
          completed_count?: number;
          failed_count?: number;
          heartbeat_at?: string | null;
          cancel_requested?: boolean;
          task_run_id?: string | null;
          last_error?: string | null;
          settings?: Json;
        };
        Update: {
          status?:
            | "queued"
            | "running"
            | "completed"
            | "failed"
            | "cancelled"
            | "paused_no_credits";
          completed_count?: number;
          failed_count?: number;
          heartbeat_at?: string | null;
          cancel_requested?: boolean;
          task_run_id?: string | null;
          last_error?: string | null;
          settings?: Json;
          updated_at?: string;
        };
      };
      notifications: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          job_run_id: string;
          event: "completed" | "failed" | "paused_no_credits";
          title: string;
          body: string;
          href: string;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          job_run_id: string;
          event: "completed" | "failed" | "paused_no_credits";
          title: string;
          body?: string;
          href?: string;
          read_at?: string | null;
        };
        Update: {
          read_at?: string | null;
        };
      };
    };
  };
}
