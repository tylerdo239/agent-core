/**
 * Parse a JSON object from an environment variable.
 *
 * `data-agent/.env` is a dotenv/Compose file, not a shell script. A common
 * import (`source .env` or `export $(cat .env | xargs)`) strips quotes from
 * JSON keys. Repair only that narrow shape; never evaluate JavaScript.
 */
export function parseJsonObjectEnv(raw: string): { value: Record<string, unknown>; repaired: boolean } {
  const parse = (candidate: string) => {
    const value: unknown = JSON.parse(candidate)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('value is not a JSON object')
    }
    return value as Record<string, unknown>
  }

  try {
    return { value: parse(raw), repaired: false }
  } catch (originalError) {
    const repairedRaw = raw.replace(
      /([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g,
      '$1"$2"$3',
    )
    if (repairedRaw === raw) throw originalError
    return { value: parse(repairedRaw), repaired: true }
  }
}
