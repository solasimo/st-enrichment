# ST Lead Enrichment

Internal tool for STMicroelectronics digital marketing teams to enrich Salesforce lead data using AI.

## How it works

1. Upload a CSV from Salesforce with Lead ID, email domain, and other lead fields
2. For each lead, the tool checks Supabase for cached data first
3. If not cached, calls Claude AI with web search to research the company
4. Saves results to Supabase so the same domain is never looked up twice
5. Download the enriched CSV

## Setup

### 1. Supabase — create the table

Go to your Supabase project → SQL Editor → run this:

```sql
create table enriched_domains (
  email_domain text primary key,
  company text,
  company_description text,
  product_description text,
  website text,
  company_linkedin_url text,
  company_revenue text,
  company_industries text,
  company_founding_date text,
  company_employees text,
  company_phone text,
  startup_information text,
  enriched_at timestamptz default now()
);
```

Then go to Settings → API and copy:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2. Anthropic API key

Get your key from [console.anthropic.com](https://console.anthropic.com) → `ANTHROPIC_API_KEY`

### 3. Local development

```bash
cp .env.example .env.local
# Fill in your keys in .env.local

npm install
npm run dev
# Open http://localhost:3000
```

### 4. Deploy to Vercel

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Deploy
vercel

# Add environment variables in Vercel dashboard:
# Settings → Environment Variables → add the 3 keys
```

Or connect your GitHub repo directly from vercel.com for automatic deploys on push.

## Environment variables

| Variable | Where to find it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |

## CSV format

Required columns: `Lead ID`, `email domain`

Optional (enriched if empty):
- company
- company description
- product description
- website
- company linkedin URL
- company revenue
- company industries
- company founding date
- company employees
- company phone
- startup information
