import { describe, expect, it } from 'vitest'
import { channelToLocation, pickEncounterLocation } from './channel-locations'

describe('channelToLocation', () => {
  it('maps known channel names to predefined locations', () => {
    const result = channelToLocation('C1', 'general', undefined)
    expect(result.locationName).toBe('みんなの広場')
    expect(result.locationEmoji).toBe('🏘️')
  })

  it('matches partial channel names', () => {
    const result = channelToLocation('C2', 'team-design-review', undefined)
    expect(result.locationName).toBe('デザインのアトリエ')
  })

  it('handles hyphenated and underscored names', () => {
    const result = channelToLocation('C3', 'dev-frontend', undefined)
    expect(result.locationName).toBe('まほうの鏡の間')
  })

  it('falls back to generated name for unknown channels', () => {
    const result = channelToLocation('C4', 'zebra-club', undefined)
    expect(result.locationName).toContain('zebra-club')
    expect(result.channelName).toBe('zebra-club')
  })

  it('produces consistent fallback for same channel name', () => {
    const a = channelToLocation('C5', 'my-channel', undefined)
    const b = channelToLocation('C5', 'my-channel', undefined)
    expect(a.locationName).toBe(b.locationName)
  })

  it('preserves topic when provided', () => {
    const result = channelToLocation('C6', 'random', 'fun times')
    expect(result.topic).toBe('fun times')
  })
})

describe('pickEncounterLocation', () => {
  it('returns null for empty array', () => {
    expect(pickEncounterLocation([])).toBeNull()
  })

  it('returns a location from the array', () => {
    const locations = [
      channelToLocation('C1', 'general', undefined),
      channelToLocation('C2', 'random', undefined),
    ]
    const result = pickEncounterLocation(locations)
    expect(result).not.toBeNull()
    expect(locations).toContainEqual(result)
  })
})
