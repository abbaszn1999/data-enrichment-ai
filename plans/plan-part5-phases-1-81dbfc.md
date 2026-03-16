# Part 5: Phase 1A (Auth), 1B (Workspaces), 1C (Team & Roles)

Detailed implementation tasks for the authentication and workspace foundation.

---

## Phase 1A: Authentication

### Goal
Email/password auth with Supabase Auth. Protect all routes except auth pages.

### Prerequisites
- Run profiles table SQL (Part 2, Table 1)
- Enable Email provider in Supabase Dashboard > Authentication > Providers
- (Dev only) Disable email confirmation in Supabase Dashboard > Authentication > Email

### New Dependency
```
npm install @supabase/ssr
```

### Tasks

#### 1A.1 — Supabase Server Client
**File**: `src/lib/supabase-server.ts`
- Create `createServerSupabaseClient()` using `@supabase/ssr` createServerClient
- Uses cookies from Next.js `cookies()` for server components and API routes
- Used in middleware.ts and API routes

#### 1A.2 — Auth Helpers
**File**: `src/lib/auth.ts`
- `signUp(email, password, fullName)` — Register + pass full_name in metadata
- `signIn(email, password)` — Login
- `signOut()` — Logout
- `resetPasswordRequest(email)` — Send reset email
- `updatePassword(newPassword)` — Set new password
- `getUser()` — Get current authenticated user (client-side)
- `getServerUser()` — Get user from server context (cookies)

#### 1A.3 — Auth Store
**File**: `src/store/auth-store.ts`
- Zustand store with fields: `user`, `profile`, `isLoading`, `isAuthenticated`
- Actions: `setUser`, `setProfile`, `clear`, `initialize`
- On initialize: fetch user from Supabase, fetch profile from profiles table

#### 1A.4 — Auth Hook
**File**: `src/hooks/use-auth.ts`
- Hook that:
  - Calls auth store `initialize()` on mount
  - Subscribes to `supabase.auth.onAuthStateChange`
  - Returns `{ user, profile, isLoading, isAuthenticated, signOut }`

#### 1A.5 — Middleware
**File**: `src/middleware.ts`
- Intercept all routes
- Public routes (no auth needed): `/login`, `/register`, `/forgot-password`, `/reset-password`, `/invite/*`, `/api/auth/*`
- Protected routes (everything else): redirect to `/login` if no session
- Auth pages: redirect to `/` if already authenticated
- Refresh session token on every request

#### 1A.6 — Auth Layout
**File**: `src/app/(auth)/layout.tsx`
- Centered layout: full-screen gradient background
- Card container in the middle
- App logo + name at top
- No sidebar, no header

#### 1A.7 — Login Page
**File**: `src/app/(auth)/login/page.tsx`
- Uses `LoginForm` component
- After success: redirect to `/` (which routes to workspaces)

**File**: `src/components/auth/login-form.tsx`
- Fields: Email, Password
- "Remember me" checkbox (optional)
- "Forgot password?" link -> `/forgot-password`
- "Don't have an account? Register" link -> `/register`
- Validation: email format, password required
- Error display: inline under fields + toast for server errors
- Loading state on submit button
- Call `signIn()` from auth.ts

#### 1A.8 — Register Page
**File**: `src/app/(auth)/register/page.tsx`
- Uses `RegisterForm` component
- After success: auto-login and redirect to `/workspaces/new`

**File**: `src/components/auth/register-form.tsx`
- Fields: Full Name, Email, Password, Confirm Password
- Validation: name required, email format, password min 8 chars, passwords match
- Call `signUp()` then auto `signIn()`
- "Already have an account? Login" link

#### 1A.9 — Forgot Password Page
**File**: `src/app/(auth)/forgot-password/page.tsx`
- Email input field
- Submit -> call `resetPasswordRequest(email)`
- Show success message: "Check your email for reset link"
- "Back to login" link

#### 1A.10 — Reset Password Page
**File**: `src/app/(auth)/reset-password/page.tsx`
- New Password + Confirm Password fields
- This page is reached via email link with token in URL
- Supabase handles token verification automatically
- Call `updatePassword(newPassword)`
- After success: redirect to `/login` with success toast

#### 1A.11 — Auth Callback Route
**File**: `src/app/api/auth/callback/route.ts`
- Handle Supabase auth redirects (email confirmation, password reset)
- Exchange code for session
- Redirect to appropriate page

#### 1A.12 — Auth Guard Component
**File**: `src/components/auth/auth-guard.tsx`
- Client component wrapping protected pages
- Shows loading spinner while checking auth
- Redirects to `/login` if not authenticated
- Renders children if authenticated

#### 1A.13 — Update Root Page
**File**: `src/app/page.tsx` (MODIFY)
- Check if user is authenticated
- If yes: redirect to `/workspaces` (or default workspace)
- If no: redirect to `/login`

#### 1A.14 — Update Header
**File**: `src/components/header.tsx` (MODIFY)
- Add user avatar + name in top-right corner
- Dropdown menu: Profile, Sign Out
- Keep existing header functionality

### UI Design Notes
- Login/Register: Clean card on subtle gradient background
- Use shadcn Input, Button, Label components
- Error messages: red text below input fields
- Loading: spinner inside submit button
- Success: sonner toast notifications

---

## Phase 1B: Workspaces

### Goal
Multi-tenant workspaces with slug-based routing. Users can create and switch between workspaces.

### Prerequisites
- Phase 1A complete
- Run workspaces + workspace_members SQL (Part 2, Tables 2-3)
- Run workspace RLS policies (Part 3)

### Tasks

#### 1B.1 — Workspace Store
**File**: `src/store/workspace-store.ts`
- Zustand store: `currentWorkspace`, `workspaces`, `userRole`, `isLoading`
- Actions: `setCurrentWorkspace`, `setWorkspaces`, `loadWorkspaces`, `clear`

#### 1B.2 — Workspace Hook
**File**: `src/hooks/use-workspace.ts`
- Hook that:
  - Loads user's workspaces on mount
  - Provides `currentWorkspace`, `userRole`
  - Functions: `switchWorkspace(slug)`, `createWorkspace(name)`

#### 1B.3 — Supabase CRUD
**File**: `src/lib/supabase.ts` (EXPAND)
- Add functions:
  - `getWorkspaces(userId)` — all workspaces where user is member
  - `getWorkspaceBySlug(slug)` — single workspace + user's role
  - `createWorkspace(name, description?)` — create + auto-slug + auto-add owner as member (trigger)
  - `updateWorkspace(id, updates)` — name, description, logo, settings
  - `deleteWorkspace(id)` — only owner

#### 1B.4 — Slug Generation
In `src/lib/utils.ts` (EXPAND):
- `generateSlug(name)` — "My Store" -> "my-store"
- `ensureUniqueSlug(slug, existingSlugs)` — append "-2", "-3" if needed
- Rules: lowercase, replace spaces with hyphens, remove special chars, max 50 chars

#### 1B.5 — Dashboard Layout
**File**: `src/app/(dashboard)/layout.tsx`
- Wraps all protected pages
- Contains AuthGuard component
- Global top bar with:
  - App logo + name (left)
  - Workspace switcher (center-left)
  - User menu (right)

#### 1B.6 — Dashboard Root
**File**: `src/app/(dashboard)/page.tsx`
- On load: check user's workspaces
- If has workspaces: redirect to first workspace dashboard `/w/{slug}`
- If no workspaces: redirect to `/workspaces/new`

#### 1B.7 — Workspaces List
**File**: `src/app/(dashboard)/workspaces/page.tsx`
- Grid of workspace cards
- Each card: name, description, member count, product count, last activity
- Click card -> navigate to `/w/{slug}`
- "Create New Workspace" button

**File**: `src/components/workspace/workspace-card.tsx`
- Card component with workspace info
- Hover effect, click to navigate
- Menu: Settings, Delete (owner only)

#### 1B.8 — Create Workspace
**File**: `src/app/(dashboard)/workspaces/new/page.tsx`
- Form: Name (required), Description (optional)
- Auto-generate slug from name (editable)
- Preview URL: `/w/my-store`
- On submit: create workspace, navigate to `/w/{slug}`

#### 1B.9 — Workspace Switcher
**File**: `src/components/workspace/workspace-switcher.tsx`
- Dropdown in global header
- Shows current workspace name
- List of all user's workspaces
- "Create New Workspace" option at bottom
- Quick switch without page reload (just navigate)

#### 1B.10 — Workspace Layout
**File**: `src/app/(dashboard)/w/[workspaceSlug]/layout.tsx`
- Load workspace by slug from URL params
- Verify user is a member (redirect to /workspaces if not)
- Set workspace in store
- Render sidebar navigation + main content area

#### 1B.11 — Workspace Sidebar
**File**: `src/components/workspace/workspace-sidebar.tsx`
- Left sidebar with navigation links:
  - Dashboard (home icon)
  - Products (package icon)
  - Categories (folder-tree icon)
  - Import (upload icon)
  - Export (download icon)
  - Team (users icon) — only if Admin+
  - Settings (settings icon) — only if Admin+
- Active state highlighting
- Collapsible (icon-only mode)
- Show workspace name + logo at top

#### 1B.12 — Workspace Dashboard
**File**: `src/app/(dashboard)/w/[workspaceSlug]/page.tsx`
- Stats cards:
  - Total Products (from master_products count)
  - Total Categories (from categories count)
  - Recent Imports (last 5 import_sessions)
  - Team Members (workspace_members count)
- Quick actions: "Upload Products", "New Import", "Export"
- Recent activity list (from activity_log, last 10)

---

## Phase 1C: Team & Roles

### Goal
Invite team members, assign roles, enforce permissions throughout the app.

### Prerequisites
- Phase 1B complete
- Run workspace_invites SQL (Part 2, Table 4)
- Run invites RLS policies (Part 3)

### Tasks

#### 1C.1 — Permissions Library
**File**: `src/lib/permissions.ts`
```typescript
type Role = 'owner' | 'admin' | 'editor' | 'viewer';

function isOwner(role: Role): boolean
function canAdmin(role: Role): boolean      // owner, admin
function canEdit(role: Role): boolean       // owner, admin, editor
function canView(role: Role): boolean       // all roles

function canManageTeam(role: Role): boolean // owner, admin
function canEditMasterData(role: Role): boolean // owner, admin
function canUploadSupplier(role: Role): boolean // owner, admin, editor
function canRunEnrichment(role: Role): boolean  // owner, admin, editor
function canApplyUpdates(role: Role): boolean   // owner, admin
function canExport(role: Role): boolean         // all roles
function canDeleteWorkspace(role: Role): boolean // owner only
```

#### 1C.2 — Role Hook
**File**: `src/hooks/use-role.ts`
- Hook that returns permission check functions for current user's role
- `const { canEdit, canAdmin, canManageTeam, ... } = useRole()`
- Gets role from workspace store

#### 1C.3 — Supabase CRUD for Invites
**File**: `src/lib/supabase.ts` (EXPAND)
- `getWorkspaceMembers(workspaceId)` — list members with profiles
- `getWorkspaceInvites(workspaceId)` — list pending invites
- `createInvite(workspaceId, email, role)` — create invite record
- `acceptInvite(token, userId)` — accept invite, create member, mark accepted
- `cancelInvite(inviteId)` — delete invite
- `updateMemberRole(memberId, newRole)` — change role
- `removeMember(memberId)` — remove from workspace

#### 1C.4 — Team Management Page
**File**: `src/app/(dashboard)/w/[workspaceSlug]/team/page.tsx`
- Only accessible to Admin+ (redirect others)
- "Invite Member" button (opens dialog)
- Members table
- Pending invites section

**File**: `src/components/workspace/team-table.tsx`
- Columns: Avatar, Name, Email, Role, Joined Date, Actions
- Actions per row:
  - Change Role dropdown (disabled for owner, disabled for self)
  - Remove button (disabled for owner, disabled for self)
- Role badge colors: owner=purple, admin=blue, editor=green, viewer=gray

**File**: `src/components/workspace/invite-dialog.tsx`
- Dialog with:
  - Email input field
  - Role selector dropdown (admin, editor, viewer — no owner)
  - Send button
- On submit: create invite, show invite link to copy
- Pending invites list below with "Cancel" option

#### 1C.5 — Accept Invite Page
**File**: `src/app/(auth)/invite/[token]/page.tsx`
- Load invite by token from URL
- If expired: show "Invite expired" message
- If already accepted: show "Already accepted" message
- If user is logged in:
  - Show workspace name + role
  - "Accept Invite" button -> join workspace, redirect to workspace
- If user is NOT logged in:
  - Show workspace name + role
  - "Login to accept" button -> redirect to /login with return URL
  - "Register to accept" button -> redirect to /register with return URL
  - After login/register: auto-redirect back to accept

#### 1C.6 — Role Enforcement in UI
- Every page/component that shows edit/delete actions checks role:
  - Products page: "Upload Products" button hidden for Viewer
  - Categories page: "Add Category" hidden for Editor/Viewer
  - Import page: "New Import" hidden for Viewer
  - Team page: hidden entirely for Editor/Viewer
  - Settings page: hidden for Editor/Viewer
  - Sidebar: conditionally show Team/Settings links

#### 1C.7 — Role Enforcement in API
- All API routes check user role before mutations
- Pattern:
  ```typescript
  const user = await getServerUser();
  const member = await getWorkspaceMember(workspaceId, user.id);
  if (!canEdit(member.role)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  ```
