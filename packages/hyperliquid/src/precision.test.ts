import { describe, expect, it } from 'vitest'
import { isValidPrice, isValidSize, roundPrice, roundSizeDown } from './precision'

describe('tick & lot size (docs examples)', () => {
  it('perp: 1234.5 valid, 1234.56 invalid', () => { expect(isValidPrice('1234.5', 'perp', 0)).toBe(true); expect(isValidPrice('1234.56', 'perp', 0)).toBe(false) })
  it('perp: 0.001234 valid, 0.0012345 invalid', () => { expect(isValidPrice('0.001234', 'perp', 0)).toBe(true); expect(isValidPrice('0.0012345', 'perp', 0)).toBe(false) })
  it('perp szDecimals=1: 0.01234 valid, 0.012345 invalid', () => { expect(isValidPrice('0.01234', 'perp', 1)).toBe(true); expect(isValidPrice('0.012345', 'perp', 1)).toBe(false) })
  it('integer prices always valid', () => { expect(isValidPrice('123456', 'perp', 5)).toBe(true); expect(isValidPrice('12345.6', 'perp', 0)).toBe(false) })
  it('spot: 0.0001234 valid for szDecimals 0..2, not >2', () => { expect(isValidPrice('0.0001234', 'spot', 0)).toBe(true); expect(isValidPrice('0.0001234', 'spot', 1)).toBe(true); expect(isValidPrice('0.0001234', 'spot', 3)).toBe(false) })
  it('roundPrice respects direction', () => {
    expect(roundPrice('97123.456', 'perp', 5, 'down')).toBe('97123')
    expect(roundPrice('97123.456', 'perp', 5, 'up')).toBe('97124')
    expect(roundPrice('3456.789', 'perp', 4, 'down')).toBe('3456.7')
    expect(roundPrice('3456.789', 'perp', 4, 'up')).toBe('3456.8')
    expect(roundPrice('0.123456789', 'perp', 0, 'down')).toBe('0.12345')
    expect(roundPrice('123456.7', 'perp', 5, 'nearest')).toBe('123460')
  })
  it('rounded prices always validate', () => {
    for (const [p, sz] of [['1.23456789', 2], ['98765.4321', 5], ['0.000123456', 0], ['42.4242', 3]] as const) {
      expect(isValidPrice(roundPrice(p, 'perp', sz), 'perp', sz)).toBe(true)
    }
  })
  it('size rounds DOWN, never increasing exposure', () => {
    expect(roundSizeDown('0.0012999', 5)).toBe('0.00129')
    expect(roundSizeDown('1.999', 0)).toBe('1')
    expect(isValidSize('1.001', 3)).toBe(true); expect(isValidSize('1.0001', 3)).toBe(false)
    expect(isValidSize('0', 3)).toBe(false)
  })
  it('rejects non-positive prices', () => { expect(() => roundPrice('0', 'perp', 2)).toThrow(); expect(() => roundPrice('-1', 'perp', 2)).toThrow() })
})
