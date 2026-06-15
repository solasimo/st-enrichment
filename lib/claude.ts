import Anthropic from '@anthropic-ai/sdk'
import { CSV_TO_DB, UNCACHED_FIELDS, LeadRow } from './csv'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ST presence by country - used to enrich company description
const ST_PRESENCE: Record<string, string> = {
  IT: 'Italy (key sites: Agrate Brianza and Catania for manufacturing and R&D)',
  FR: 'France (headquarters in Geneva area; major sites in Grenoble and Crolles for R&D and manufacturing)',
  DE: 'Germany (sales and application engineering offices in Munich and other cities)',
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

export async function enrichDomain(
  domain: string,
  existingData: Partial<LeadRow>
): Promise<Record<string, string>> {
  const country = existingData['country'] || ''
  const stPresence = country && ST_PRESENCE[country.toUpperCase()]
    ? `\nNote: for the "company description" field, if the lead is from ${country}, mention any relevant local presence of the company in that country. Also note that STMicroelectronics has a significant presence in ${ST_PRESENCE[country.toUpperCase()]} — you may reference this context when evaluating good fit if relevant.`
    : ''

  // Cached fields to fill (skip company description if country present — always re-generate)
  const cachedFieldsToFill = Object.keys(CSV_TO_DB).filter((f) => {
    if (f === 'company description' && country) return true // always regenerate with country context
    return !existingData[f]
  })

  // Uncached fields — always evaluate
  const uncachedFieldsToFill = UNCACHED_FIELDS.filter((f) => !existingData[f])

  const allFieldsToFill = [...cachedFieldsToFill, ...uncachedFieldsToFill]

  if (allFieldsToFill.length === 0) return {}

  const knownFields = Object.keys(CSV_TO_DB)
    .filter((f) => existingData[f] && f !== 'company description')
    .map((f) => `  - ${f}: ${existingData[f]}`)
    .join('\n') || '  (none)'

  const prompt = `You are a B2B company research specialist helping STMicroelectronics (ST) enrich Salesforce lead data for digital marketing campaigns.

Research the company associated with the email domain "${domain}" and return structured data for the fields listed below.${stPresence}

Already known (do NOT override these):
${knownFields}

Fields to research and fill (return ALL of these):
${allFieldsToFill.map((f) => `  - ${f}`).join('\n')}

Field definitions:
- company: Official company name
- company description: 2-3 sentence professional description of what the company does${country ? `. If the company has a local presence in ${country}, mention it specifically (e.g. local offices, manufacturing sites, R&D centers).` : ''}
- product description: What products or services they sell (focus on electronics/technology relevance)
- website: Full URL including https://
- company linkedin URL: Full LinkedIn company page URL
- company revenue: Annual revenue in USD (e.g. "$50M", "$1.2B", "< $10M")
- company industries: Comma-separated industry categories (e.g. "Industrial Automation, IoT, Consumer Electronics")
- company founding date: Year founded (e.g. "2003") or full date "YYYY-MM-DD"
- company employees: Headcount range or number (e.g. "500-1000", "~5000")
- company phone: Main office phone number with country code
- startup information: If a startup — funding stage, total funding raised, key investors. Leave blank if not applicable.
- good fit: Answer ONLY "YES" or "NO". Evaluate whether this company is a good potential customer for STMicroelectronics. Consider: does the company design or manufacture electronic products? Do they work in industries where ST has strong products (automotive, industrial, IoT, consumer electronics, energy, medical, communications)? Would they likely use semiconductors, microcontrollers, power management ICs, or sensors?
- good fit notes: 2-3 sentences explaining the YES or NO decision for "good fit". Be specific about which ST product categories could be relevant (or why there is no fit).

Respond ONLY with a valid JSON object. Keys must be exactly the field names listed above. Values must be strings. No explanation, no markdown, no preamble.

Example: {"company": "Acme Corp", "company description": "Acme Corp is an Italian manufacturer of industrial automation equipment with facilities in Milan and Turin.", "good fit": "YES", "good fit notes": "Acme designs embedded motor control systems that typically require microcontrollers and power ICs — both core ST product categories. Their industrial automation focus aligns well with ST's STM32 and motor driver portfolio."}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.messages.create as any)({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }],
  })

  // Extract text blocks only (skip tool_use)
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

  // Return all filled fields
  const result: Record<string, string> = {}
  allFieldsToFill.forEach((f) => {
    if (parsed[f] && String(parsed[f]).trim()) {
      result[f] = String(parsed[f]).trim()
    }
  })

  return result
}
