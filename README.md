# ⚡ ERA — AI Full-Stack Website & App Builder
> **Build it. Test it. Ship it.**
> Turn a single prompt into a working full-stack web application. Design, generate, verify, and run editable React 19 frontend + Express 5 backend + PostgreSQL code in one unified workspace.
> 
 * **🚀 Live Cloud Platform:** https://era-ai-69zg.onrender.com *(Get 100 free starter credits on Google Sign-In — zero setup required)*
 * **📖 Documentation:** https://era-ai-69zg.onrender.com/docs
 * **🗄️ Database Architecture:** https://era-ai-69zg.onrender.com/database
 * **💳 Pricing & Plans:** https://era-ai-69zg.onrender.com/pricing
 * **📄 License:** Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
## ✨ Key Capabilities
Most AI website builders stop at static single-page HTML mockups. **ERA** is a full-stack software engineering workspace that plans, generates, patches, and executes real multi-file web applications:

| Capability | How ERA Works |
| :--- | :--- |
| **🧠 Plan-Then-Build AI Pipeline** | Drafts a structured architectural blueprint first, then synthesizes multi-file frontend and backend code using **Google Gemini (@google/genai)** with targeted file-level patching. |
| **🐳 Isolated Daytona Cloud Sandboxes** | Spins up isolated **Daytona (@daytona/sdk)** Linux containers per project so generated Node.js / Express backends execute safely in real time. |
| **🗄️ Per-Project Neon Serverless Postgres** | Automatically provisions dedicated **Neon (@neondatabase/serverless)** PostgreSQL databases over HTTPS so generated CRUD apps persist real data immediately. |
| **📎 Multimodal Attachments & Voice Input** | Attach UI reference screenshots, PDFs, markdown specs, or code files directly into the prompt bar, or dictate prompts using built-in voice recognition. |
| **🔐 First-Party Google OAuth 2.0 (PKCE)** | Uses secure, cookie-backed (era_session) Google OAuth 2.0 authentication with SHA-256 hashed session tokens and PKCE verification. |
| **📦 Full Code Inspector & ZIP Export** | Inspect and edit every generated file directly inside the browser IDE, preview responsive layouts (Desktop / Tablet / Mobile), or export a clean ZIP archive. |

## 🏗️ Monorepo Structure
```text
era-ai/
├── artifacts/
│   ├── era/                  # React 19 + Vite + Tailwind CSS v4 + Wouter frontend IDE
│   │   ├── src/components/   # Builder IDE, code inspector, preview frame, sidebar
│   │   ├── src/context/      # First-party Google OAuth & workspace state contexts
│   │   └── src/pages/        # Marketing landing, pricing, docs, database, builder
│   └── api-server/           # Express 5 + TypeScript backend API server
│       ├── src/lib/          # Gemini AI, Daytona runner, Neon DB provisioner, Google OAuth
│       ├── src/middlewares/  # Session auth & request validation
│       └── src/routes/       # AI generation, workspaces, projects, credits, auth routes
├── lib/
│   ├── db/                   # Drizzle ORM + PostgreSQL schema (users, projects, sessions, workspaces)
│   ├── api-spec/             # OpenAPI 3.0 specification
│   ├── api-client-react/     # Generated TanStack React Query hooks
│   └── api-zod/              # Generated Zod validation schemas
├── README.md
└── LICENSE.txt               # CC BY-NC 4.0 License
```
## ⚙️ Environment Variables (.env Configuration)
To run ERA locally with full AI generation, Google OAuth sign-in, isolated **Daytona** container workspaces, and per-project **Neon** PostgreSQL databases, create a .env file in the root directory with the following variables:
```dotenv
# ============================================================================
# 1. Core Database & Server
# ============================================================================
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/era
NODE_ENV=development
PORT=5000
LOG_LEVEL=info
# ============================================================================
# 2. Google Gemini AI (Required for AI Planning & Code Generation)
# ============================================================================
# Get your key at https://aistudio.google.com/apikey
GOOGLE_AI_API_KEY=your_google_gemini_api_key
# ============================================================================
# 3. Google OAuth 2.0 PKCE Authentication (Required for Sign-In)
# ============================================================================
# Create a Web Application OAuth client in Google Cloud Console
# Authorized Redirect URI: http://localhost:5000/api/auth/google/callback
GOOGLE_OAUTH_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret
AUTH_PUBLIC_ORIGIN=http://localhost:5000
ALLOWED_ORIGINS=http://localhost:5000,http://localhost:5173
# Optional explicit callback override:
# GOOGLE_OAUTH_REDIRECT_URI=http://localhost:5000/api/auth/google/callback
# ============================================================================
# 4. Isolated Full-Stack Runtime Providers (Daytona + Neon)
# ============================================================================
# DAYTONA_API_KEY: Spins up isolated Daytona cloud containers for live backend execution
DAYTONA_API_KEY=your_daytona_api_key
# NEON_API_KEY: Provisions isolated per-project Neon serverless PostgreSQL databases
NEON_API_KEY=your_neon_api_key
# Workspace resource guardrails
ERA_RUNTIME_MAX_PROJECTS=3
ERA_RUNTIME_FREE_TRIAL_BUDGET_USD=5
# ============================================================================
# 5. Workspace Credential Encryption (Required)
# ============================================================================
# Used to encrypt per-project Daytona & Neon workspace credentials at rest (AES-256-GCM)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=replace_with_a_random_64_char_hex_secret
# ============================================================================
# 6. Razorpay Credit Billing (Optional — for Credit Top-Up Checkout)
# ============================================================================
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
```
### Environment Variable Reference

| Variable | Required? | Purpose |
| :--- | :--- | :--- |
| DATABASE_URL | **Required** | Main PostgreSQL connection string for ERA users, sessions, projects, and chat history. |
| GOOGLE_AI_API_KEY | **Required** | Google Gemini API key used for project planning, full-stack code generation, and web-grounded search. |
| GOOGLE_OAUTH_CLIENT_ID | **Required** | Google Cloud OAuth 2.0 Web Client ID for "Continue with Google" sign-in. |
| GOOGLE_OAUTH_CLIENT_SECRET | **Required** | Google Cloud OAuth 2.0 Web Client Secret. |
| SESSION_SECRET | **Required** | Secret key used to derive the AES-256-GCM key that encrypts Daytona and Neon workspace credentials stored in the database. |
| DAYTONA_API_KEY | **Required for Full-Stack Run** | Authenticates @daytona/sdk (workspace-provider.ts) to create, start, and execute generated full-stack projects inside isolated Daytona cloud sandboxes. |
| NEON_API_KEY | **Required for Full-Stack Run** | Authenticates with the Neon API (https://console.neon.tech/api/v2) to provision a dedicated serverless PostgreSQL database for each generated full-stack project. |
| ERA_RUNTIME_MAX_PROJECTS | Optional (Default: 3) | Maximum number of active full-stack runtime workspaces allowed per user. |
| ERA_RUNTIME_FREE_TRIAL_BUDGET_USD | Optional (Default: 5) | Free-trial runtime budget cap (in USD) enforced by the workspace runner. |
| AUTH_PUBLIC_ORIGIN | Optional | Canonical public origin (e.g., https://era-ai-69zg.onrender.com) used to construct Google OAuth callback URLs. |
| ALLOWED_ORIGINS | Optional | Comma-separated list of allowed CORS origins. |
| RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET | Optional | Enables Razorpay order creation and webhook verification for purchasing Starter (100), Pro (500), and Max (2,000) credit packs. |

## 🚀 Getting Started
### Option 1 — Instant Cloud Workspace (No Setup Required)
If you want to build and preview full-stack apps immediately without configuring PostgreSQL, Google Cloud OAuth, Daytona containers, or Neon API keys:
 1. Visit **https://era-ai-69zg.onrender.com**
 2. Click **Sign in with Google** to receive **100 free starter credits**
 3. Enter your prompt (or attach a screenshot/PDF) and start building
### Option 2 — Personal / Non-Commercial Self-Hosting
#### Prerequisites
 * **Node.js** v20+ and **pnpm** v9+
 * **PostgreSQL** v15+ (local or hosted on Neon/Supabase/Render)
 * **Google Gemini API Key** (Google AI Studio)
 * **Daytona API Key** & **Neon API Key** *(for live full-stack container & database execution)*
#### Installation & Launch
```bash
# 1. Clone the repository
git clone https://github.com/rehanmullick76-hub/era-ai.git
cd era-ai
# 2. Install monorepo dependencies
pnpm install
# 3. Configure your environment variables
cp .env.example .env
# Edit .env and add DATABASE_URL, GOOGLE_AI_API_KEY, GOOGLE_OAUTH_*, DAYTONA_API_KEY, NEON_API_KEY, and SESSION_SECRET
# 4. Push the PostgreSQL database schema & Google OAuth tables
pnpm --filter @workspace/db run push
node lib/db/scripts/migrate-google-auth.mjs
# 5. Build the React 19 frontend and Express 5 backend
pnpm --filter @workspace/era run build
pnpm --filter @workspace/api-server run build
# 6. Start the production server
pnpm --filter @workspace/api-server run start
```
## 🛡️ Security & Workspace Isolation
 * **Encrypted Workspace Credentials:** Per-project Daytona sandbox IDs and Neon database connection strings are encrypted at rest using AES-256-GCM derived from SESSION_SECRET (artifacts/api-server/src/lib/workspace-policy.ts).
 * **Automatic Secret Redaction:** Server and workspace logs automatically strip API keys (GOOGLE_AI_API_KEY, DAYTONA_API_KEY, NEON_API_KEY, SESSION_SECRET, DATABASE_URL, RAZORPAY_KEY_SECRET) before streaming logs to the browser.
 * **PKCE + State Hashing:** Google OAuth 2.0 login flows enforce S256 PKCE code challenges, cryptographic nonce validation, and SHA-256 hashed session tokens (era_session).
## 📄 License (CC BY-NC 4.0)
Copyright © 2026 ERA. All rights reserved.
This repository is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)**:
 * **✅ Permitted:** Personal, academic, educational, and non-commercial evaluation, self-hosting, and modification with clear attribution to ERA.
 * **❌ Strictly Prohibited:** Commercial use, paid hosting, reselling, or offering ERA (or any derivative work) as a commercial SaaS/PaaS service without a separate commercial license from the author.
