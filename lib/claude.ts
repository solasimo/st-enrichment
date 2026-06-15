import Anthropic from '@anthropic-ai/sdk'
import { CSV_TO_DB, LeadRow } from './csv'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ST local presence by country code
const ST_PRESENCE: Record<string, string> = {
  IT: 'Italy (key manufacturing and R&D sites in Agrate Brianza and Catania)',
  FR: 'France (headquarters in Geneva area; major R&D and manufacturing in Grenoble and Crolles)',
  DE: 'Germany (sales and application engineering in Munich and other cities)',
  US: 'United States (offices in Dallas, San Jose, and other tech hubs)',
  CN: 'China (significant presence in Shenzhen, Shanghai, and Beijing)',
  JP: 'Japan (offices in Tokyo and Osaka)',
  IN: 'India (R&D and engineering centers in Noida and Bangalore)',
  GB: 'United Kingdom (offices in Bristol and other cities)',
  SG: 'Singapore (Asia-Pacific regional hub)',
  MY: 'Malaysia (manufacturing in Muar)',
  MO: 'Morocco (manufacturing in Bouskoura)',
  MT: 'Malta (manufacturing site)',
  PH: 'Philippines (manufacturing in Calamba)',
}

// ── Step 1: Full enrichment with web search ───────────────────────────────────
// Called only when domain is NOT in cache.
// Returns all domain-level fields + good fit + good fit notes.

export async function enrichDomain(
  domain: string,
  existingData: Partial<LeadRow>
): Promise<Record<string, string>> {
  const country = existingData['country'] || ''
  const stPresence = country && ST_PRESENCE[country.toUpperCase()]
    ? `The lead is from ${country}. STMicroelectronics has a significant presence in ${ST_PRESENCE[country.toUpperCase()]}. If the company also has local presence in ${country}, mention it in the company description.`
    : ''

  const fieldsToFill = Object.keys(CSV_TO_DB).filter((f) => !existingData[f])
  const allFieldsToFill = [...fieldsToFill, 'good fit', 'good fit notes']

  const knownFields = Object.keys(CSV_TO_DB)
    .filter((f) => existingData[f])
    .map((f) => `  - ${f}: ${existingData[f]}`)
    .join('\n') || '  (none)'

  const prompt = `You are a B2B company research specialist helping STMicroelectronics (ST) enrich Salesforce lead data for digital marketing campaigns.

Research the company associated with the email domain "${domain}".
${stPresence}

Already known (do NOT override):
${knownFields}

Fields to fill (return ALL of these, omit only if truly impossible to find):
${allFieldsToFill.map((f) => `  - ${f}`).join('\n')}

Field definitions:
- company: Official company name
- company description: 2-3 sentence description of what the company does. If the lead is from a specific country and the company has local presence there, mention it.
- product description: Products or services they sell, with focus on electronics/technology relevance.
- website: Full URL including https://
- company linkedin URL: Full LinkedIn company page URL
- company revenue: Annual revenue in USD (e.g. "$50M", "$1.2B", "< $10M")
- company industries: Comma-separated industry categories (e.g. "Industrial Automation, IoT, Consumer Electronics")
- company founding date: Year founded (e.g. "2003") or "YYYY-MM-DD"
- company employees: Headcount range or number (e.g. "500-1000", "~5000")
- company phone: Main office phone number with country code
- startup information: Funding stage, total raised, key investors if startup. Blank if not applicable.
- good fit: "YES" or "NO" — is this company a good potential customer for STMicroelectronics? Consider: do they design/manufacture electronic products? Do they operate in ST's target industries (automotive, industrial, IoT, consumer electronics, energy, medical, communications)?
- good fit notes: 2-3 sentences explaining the YES/NO. Be specific about which ST product categories are relevant (e.g. STM32 microcontrollers, power management ICs, motor drivers, sensors) or why there is no fit.

Respond ONLY with a valid JSON object. Keys must match field names exactly. Values are strings. No markdown, no explanation.`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.messages.create as any)({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }],
  })

  return extractJSON(response, allFieldsToFill)
}

// ── Step 2: Good fit only — no web search, uses cached data ──────────────────
// Called when domain IS in cache. Fast and cheap.

export async function evaluateGoodFit(
  cachedData: Partial<LeadRow>,
  country: string
): Promise<Record<string, string>> {
  const stPresence = country && ST_PRESENCE[country.toUpperCase()]
    ? `The lead is from ${country}. ST has presence in ${ST_PRESENCE[country.toUpperCase()]}.`
    : ''

  const context = Object.entries(cachedData)
    .filter(([, v]) => v)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join('\n')

  const prompt = `You are a B2B sales analyst at STMicroelectronics evaluating whether a company is a good potential customer.

${stPresence}

Company information:
${context}

Based on the above, evaluate the fit:
- good fit: "YES" or "NO" — does this company likely design or manufacture electronic products, or operate in ST's target industries (automotive, industrial, IoT, consumer electronics, energy, medical, communications)?
- good fit notes: 2-3 sentences explaining why YES or NO. Reference specific ST product categories where relevant (STM32, power management ICs, motor drivers, MEMS sensors, SiC, etc.).

Respond ONLY with a JSON object with exactly two keys: "good fit" and "good fit notes". No markdown, no explanation.`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlocks = response.content.filter((b) => b.type === 'text')
  if (!textBlocks.length) return {}
  const raw = textBlocks.map((b) => (b as { type: 'text'; text: string }).text).join('')
  const clean = raw.replace(/```json|```/g, '').trim()

  try {
    const parsed = JSON.parse(clean)
    return {
      'good fit': String(parsed['good fit'] || '').trim(),
      'good fit notes': String(parsed['good fit notes'] || '').trim(),
    }
  } catch {
    return {}
  }
}

// ── Shared helper ─────────────────────────────────────────────────────────────

function extractJSON(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any,
  fieldsToFill: string[]
): Record<string, string> {
  const content = response.content as Array<{ type: string; text?: string }>
  const textBlocks = content.filter((b) => b.type === 'text')
  if (!textBlocks.length) throw new Error('No text response from Claude')

  const raw = textBlocks.map((b) => b.text ?? '').join('')
  const clean = raw.replace(/```json|```/g, '').trim()

  let parsed: Record<string, string>
  try {
    parsed = JSON.parse(clean)
  } catch {
    const match = clean.match(/\{[\s\S]*\}/)
    if (match) parsed = JSON.parse(match[0])
    else throw new Error('Could not parse Claude response as JSON')
  }

  const result: Record<string, string> = {}
  fieldsToFill.forEach((f) => {
    if (parsed[f] && String(parsed[f]).trim()) {
      result[f] = String(parsed[f]).trim()
    }
  })
  return result
}
