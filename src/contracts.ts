import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'

export class ContractValidationError extends Error {
  constructor(
    public readonly contract: string,
    public readonly errors: ErrorObject[] | null | undefined,
  ) {
    const details = errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')
    super(`Invalid ${contract}${details ? `: ${details}` : ''}`)
    this.name = 'ContractValidationError'
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validators = new Map<string, ValidateFunction>()

export function registerContract(name: string, schema: object): void {
  validators.set(name, ajv.compile(schema))
}

export function validateContract<T>(name: string, value: unknown): T {
  const validator = validators.get(name)
  if (!validator) throw new Error(`Contract is not registered: ${name}`)
  if (!validator(value)) throw new ContractValidationError(name, validator.errors)
  return value as T
}

export function createContractValidator<T>(name: string, schema: object): (value: unknown) => T {
  const validator = ajv.compile(schema)
  return (value: unknown) => {
    if (!validator(value)) throw new ContractValidationError(name, validator.errors)
    return value as T
  }
}
