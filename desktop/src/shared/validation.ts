import type { JsonValue, Result, ValidationIssue, IssueReason } from './contracts'

export const MAX_DTO_BYTES = 1024 * 1024
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export const success = <T>(data: T): Result<T> => ({ ok: true, data })
export function validationFailure(issues: ValidationIssue[]): Result<never> {
  return { ok: false, error: { code: 'VALIDATION', message: '数据结构校验失败。', issues } }
}
export function issue(field: string, reason: IssueReason, message: string): ValidationIssue {
  return { field, reason, message }
}

// Do not invoke getters/toJSON or trust prototypes. This boundary also handles
// cycles, sparse arrays, symbols, non-finite numbers and oversized hostile DTOs.
export function validateJsonDto(input: unknown): Result<JsonValue> {
  const issues: ValidationIssue[] = []
  const ancestors = new Set<object>()
  let nodes = 0
  let characters = 0
  function reject(path: string, reason: IssueReason, message: string): undefined {
    if (issues.length < 50) issues.push(issue(path, reason, message))
    return undefined
  }
  function visit(value: unknown, path: string, depth: number): JsonValue | undefined {
    if (++nodes > 100_000 || depth > 64) return reject(path, 'LIMIT', '数据过深或过大。')
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string') {
      characters += value.length
      return characters > MAX_DTO_BYTES ? reject(path, 'LIMIT', '数据过大。') : value
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : reject(path, 'NOT_SERIALIZABLE', '数值必须有限。')
    if (typeof value !== 'object') return reject(path, 'NOT_SERIALIZABLE', '只接受JSON数据值。')
    if (ancestors.has(value)) return reject(path, 'NOT_SERIALIZABLE', '不接受循环引用。')
    const array = Array.isArray(value)
    const proto = Object.getPrototypeOf(value)
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) {
      return reject(path, 'NOT_SERIALIZABLE', '不接受类实例或自定义原型。')
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.some(key => typeof key !== 'string')) return reject(path, 'NOT_SERIALIZABLE', '不接受Symbol键。')
    for (const key of keys as string[]) {
      if (DANGEROUS_KEYS.has(key)) return reject(`${path}.${key}`, 'DANGEROUS_KEY', '不接受危险对象键。')
      if (array && key === 'length') continue
      const descriptor = descriptors[key]
      if (!descriptor.enumerable || !('value' in descriptor)) return reject(`${path}.${key}`, 'NOT_SERIALIZABLE', '不接受访问器或隐藏属性。')
      characters += key.length
    }
    ancestors.add(value)
    try {
      if (array) {
        const length = descriptors.length.value as number
        if (length > 100_000 || keys.length !== length + 1) return reject(path, 'NOT_SERIALIZABLE', '数组不能稀疏或包含附加属性。')
        const output: JsonValue[] = []
        for (let i = 0; i < length; i++) {
          const descriptor = descriptors[String(i)]
          if (!descriptor) return reject(path, 'NOT_SERIALIZABLE', '数组元素不能缺失。')
          const item = visit(descriptor.value, `${path}[${i}]`, depth + 1)
          if (item === undefined) return undefined
          output.push(item)
        }
        return output
      }
      const output: Record<string, JsonValue> = Object.create(null)
      for (const key of keys as string[]) {
        const item = visit(descriptors[key].value, `${path}.${key}`, depth + 1)
        if (item === undefined) return undefined
        output[key] = item
      }
      return output
    } finally { ancestors.delete(value) }
  }
  try {
    const value = visit(input, '$', 0)
    if (value === undefined || issues.length) return validationFailure(issues)
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_DTO_BYTES) {
      return validationFailure([issue('$', 'LIMIT', 'JSON数据不得超过1 MiB。')])
    }
    return success(value)
  } catch {
    return validationFailure([issue('$', 'NOT_SERIALIZABLE', '无法读取安全的数据对象。')])
  }
}

export type Validator<T> = (value: JsonValue | undefined, field: string, issues: ValidationIssue[]) => T | undefined
function invalid(issues: ValidationIssue[], field: string, reason: IssueReason, message: string): undefined {
  if (issues.length < 50) issues.push(issue(field, reason, message))
  return undefined
}
export const v = {
  string(pattern?: RegExp, max = 2048): Validator<string> {
    return (value, field, issues) => {
      if (typeof value !== 'string') return invalid(issues, field, value === undefined ? 'MISSING_FIELD' : 'TYPE', '必须为字符串。')
      if (!value.trim() || value.length > max) return invalid(issues, field, 'RANGE', '字符串为空或过长。')
      if (pattern && !pattern.test(value)) return invalid(issues, field, 'FORMAT', '字符串格式不正确。')
      return value
    }
  },
  number(min: number, max: number, integer = true): Validator<number> {
    return (value, field, issues) => {
      if (typeof value !== 'number') return invalid(issues, field, value === undefined ? 'MISSING_FIELD' : 'TYPE', '必须为数值。')
      if (!Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < min || value > max) return invalid(issues, field, 'RANGE', '数值超出允许范围。')
      return value
    }
  },
  boolean: ((value, field, issues) => typeof value === 'boolean' ? value : invalid(issues, field, value === undefined ? 'MISSING_FIELD' : 'TYPE', '必须为布尔值。')) as Validator<boolean>,
  enum<T extends string | number | boolean | null>(values: readonly T[]): Validator<T> {
    return (value, field, issues) => values.includes(value as T) ? value as T : invalid(issues, field, value === undefined ? 'MISSING_FIELD' : 'ENUM', '必须使用允许的枚举值。')
  },
  nullable<T>(validator: Validator<T>): Validator<T | null> {
    return (value, field, issues) => value === null ? null : validator(value, field, issues)
  },
  array<T>(validator: Validator<T>, min = 0, max = 100_000, uniqueKey?: (item: T) => string | number): Validator<T[]> {
    return (value, field, issues) => {
      if (!Array.isArray(value)) return invalid(issues, field, value === undefined ? 'MISSING_FIELD' : 'TYPE', '必须为数组。')
      if (value.length < min || value.length > max) return invalid(issues, field, 'RANGE', '数组长度不正确。')
      const output: T[] = [], seen = new Set<string | number>()
      value.forEach((item, index) => {
        const parsed = validator(item, `${field}[${index}]`, issues)
        if (parsed === undefined) return
        if (uniqueKey) {
          const key = uniqueKey(parsed)
          if (seen.has(key)) invalid(issues, `${field}[${index}]`, 'DUPLICATE', '不接受重复条目。')
          seen.add(key)
        }
        output.push(parsed)
      })
      return output
    }
  },
  object<T>(shape: { [K in keyof T]-?: Validator<T[K]> }): Validator<T> {
    return (value, field, issues) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid(issues, field, value === undefined ? 'MISSING_FIELD' : 'TYPE', '必须为对象。')
      for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(shape, key)) invalid(issues, `${field}.${key}`, 'UNKNOWN_FIELD', '不接受未知字段。')
      const output: Record<string, unknown> = {}
      for (const key of Object.keys(shape) as Array<keyof T & string>) {
        const parsed = shape[key](Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined, `${field}.${key}`, issues)
        if (parsed !== undefined) output[key] = parsed
      }
      return output as T // Only whitelist fields parsed by the declared validators.
    }
  },
  record<T>(keyValidator: Validator<string>, validator: Validator<T>, max = 10_000): Validator<Record<string, T>> {
    return (value, field, issues) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid(issues, field, value === undefined ? 'MISSING_FIELD' : 'TYPE', '必须为对象。')
      if (Object.keys(value).length > max) return invalid(issues, field, 'LIMIT', '条目数过多。')
      const output: Record<string, T> = Object.create(null)
      for (const key of Object.keys(value)) {
        const parsedKey = keyValidator(key, `${field}.${key}`, issues)
        const parsedValue = validator(value[key], `${field}.${key}`, issues)
        if (parsedKey !== undefined && parsedValue !== undefined) output[parsedKey] = parsedValue
      }
      return output
    }
  }
}
export function validateStructure<T>(input: unknown, validator: Validator<T>): Result<T> {
  const json = validateJsonDto(input)
  if (!json.ok) return json
  const issues: ValidationIssue[] = []
  const parsed = validator(json.data, '$', issues)
  return parsed === undefined || issues.length ? validationFailure(issues) : success(parsed)
}
