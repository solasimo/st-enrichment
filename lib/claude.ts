import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ST local presence by country code
const ST_PRESENCE: Record<string, string> = {
  IT: 'Italy: manufacturing and R&D in Agrate Brianza and Catania',
  FR: 'France: R&D and manufacturing in Grenoble and Crolles',
  DE: 'Germany: sales and application engineering in Munich',
  US: 'United States: offices in Dallas and San Jose',
  CN: 'China: presence in Shenzhen, Shanghai, Beijing',
  JP: 'Japan: offices in Tokyo and Osaka',
  IN: 'India: R&D in Noida and Bangalore',
  GB: 'United Kingdom: offices in Bristol',
  SG: 'Singapore: Asia-Pacific hub',
  MY: 'Malaysia: manufacturing in Muar',
  MO: 'Morocco: manufacturing in Bouskoura',
  MT: 'Malta: manufacturing site',
  PH: 'Philippines: manufacturing in Calamba',
}

// Fields collected via web search
const SEARCH_FIELDS = [
  'company',
  'company description',
  'product description',
  'website',
  'company linkedin URL',
  'company revenue',
  'company industries',
  'company founding date',
  'company employees',
  'company phone',
  'startup information',
]

// ── Step 1: Web search — collect raw data ────────────────────────────────────

async function collectRawData(domain: string, company: string, country: string): Promise<string> {
  const countryCtx = country && ST_PRESENCE[country.toUpperCase()]
    ? ` The lead is from ${country} (ST presence: ${ST_PRESENCE[country.toUpperCase()]}).`
    : ''

  const prompt = `Research the company at domain "${domain}"${company ? ` (company: ${company})` : ''}.${countryCtx}

Find: official name, description, products/services, website, LinkedIn URL, annual revenue, industries, founding year, employee count, phone number, startup/funding info.

If the lead country is provided and the company has local presence there, note it.

Return a concise summary paragraph with all found data. Be factual and brief.`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.messages.create as any)({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }],
  })

  const content = response.content as Array<{ type: string; text?: string }>
  return content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
}

// ── Step 2: Structure — format raw data into CRM fields ──────────────────────

async function structureData(
  rawData: string,
  fieldsToFill: string[],
  country: string
): Promise<Record<string, string>> {
  const countryCtx = country && ST_PRESENCE[country.toUpperCase()]
    ? ` Lead country: ${country}.`
    : ''

  const fieldSpecs = fieldsToFill.map((f) => {
    switch (f) {
      case 'company':               return '- company: Text, official name, max 255 chars'
      case 'company description':   return `- company description: Text, max 255 chars, 1-2 sentences on what company does${country ? `, mention local presence in ${country} if any` : ''}`
      case 'product description':   return '- product description: Rich text, what they sell, focus on electronics/tech relevance, max 500 chars'
      case 'website':               return '- website: URL with https://, max 255 chars'
      case 'company linkedin URL':  return '- company linkedin URL: LinkedIn company URL, max 255 chars'
      case 'company revenue':       return '- company revenue: Integer only, no symbols/text (e.g. 49000000)'
      case 'company industries':    return '- company industries: 2-3 core industries comma-separated, industry type not markets served (e.g. "Semiconductor, Electronic Components" not "Automotive, Industrial"), max 255 chars'
      case 'company founding date': return '- company founding date: 4-digit year only (e.g. 2003)'
      case 'company employees':     return '- company employees: Integer only, no symbols/text (e.g. 5000)'
      case 'company phone':         return '- company phone: International format with + prefix (e.g. +41229292929)'
      case 'startup information':   return '- startup information: Rich text, funding stage, total raised, key investors. Empty string if not a startup.'
      default: return `- ${f}`
    }
  }).join('\n')

  const prompt = `You are a CRM data formatter for STMicroelectronics.${countryCtx}

Source data:
${rawData}

Extract and format the following fields from the source data. Return ONLY a JSON object with these exact keys. Omit fields not found in the source data. No markdown, no explanation.

${fieldSpecs}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')

  return parseJSON(text, fieldsToFill)
}

// ── Step 3: Good fit evaluation — no web search ──────────────────────────────

async function evaluateFit(
  companyData: Record<string, string>,
  country: string
): Promise<{ 'good fit': string; 'good fit notes': string }> {
  const ctx = Object.entries(companyData)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

  const stCtx = country && ST_PRESENCE[country.toUpperCase()]
    ? ` ST presence in ${country}: ${ST_PRESENCE[country.toUpperCase()]}.`
    : ''

  const prompt = `Evaluate if this company is a good potential customer for STMicroelectronics (semiconductors: MCUs, power ICs, sensors, SiC, motor drivers).${stCtx}

${ctx}

Return JSON with exactly two keys:
- "good fit": "YES" or "NO"
- "good fit notes": 2 sentences max explaining why, referencing specific ST product categories where relevant`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')

  const parsed = parseJSON(text, ['good fit', 'good fit notes'])
  return {
    'good fit': parsed['good fit'] || '',
    'good fit notes': parsed['good fit notes'] || '',
  }
}

// ── Public: full enrichment (domain not in cache) ────────────────────────────

export async function enrichDomain(
  domain: string,
  existingData: Record<string, string>
): Promise<Record<string, string>> {
  // Only pass minimal anchor context
  const company = existingData['company'] || ''
  const country = (existingData['country'] || '').toUpperCase()

  const fieldsToFill = SEARCH_FIELDS.filter((f) => !existingData[f])

  // Step 1: web search
  const rawData = await collectRawData(domain, company, country)

  // Step 2: structure into CRM format
  const structured = fieldsToFill.length > 0
    ? await structureData(rawData, fieldsToFill, country)
    : {}

  // Step 3: good fit evaluation
  const companyContext = { ...existingData, ...structured }
  const fit = await evaluateFit(companyContext, country)

  return { ...structured, ...fit }
}

// ── Public: good fit only (domain in cache) ───────────────────────────────────

export async function evaluateGoodFit(
  cachedData: Record<string, string>,
  country: string
): Promise<Record<string, string>> {
  const fit = await evaluateFit(cachedData, country.toUpperCase())
  return fit
}

// ── Helper ────────────────────────────────────────────────────────────────────

function parseJSON(text: string, expectedKeys: string[]): Record<string, string> {
  const clean = text.replace(/```json|```/g, '').trim()
  let parsed: Record<string, string> = {}
  try {
    parsed = JSON.parse(clean)
  } catch {
    const match = clean.match(/\{[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { return {} }
    } else {
      return {}
    }
  }

  const result: Record<string, string> = {}
  expectedKeys.forEach((k) => {
    if (parsed[k] !== undefined && parsed[k] !== null && String(parsed[k]).trim()) {
      result[k] = String(parsed[k]).trim()
    }
  })
  return result
}
