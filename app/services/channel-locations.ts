/**
 * Maps Slack public channels to fantasy location names for character adventures.
 *
 * Only uses public channel metadata (name, topic, purpose) — never message content.
 * Private channels and DMs are completely excluded.
 */

/** Known keyword-to-location mappings for common channel names */
const CHANNEL_LOCATION_MAP: Record<string, { name: string; emoji: string }> = {
  general: { name: 'みんなの広場', emoji: '🏘️' },
  random: { name: 'ふしぎの森', emoji: '🌳' },
  design: { name: 'デザインのアトリエ', emoji: '🎨' },
  engineering: { name: 'からくり工房', emoji: '⚙️' },
  frontend: { name: 'まほうの鏡の間', emoji: '🪞' },
  backend: { name: '地下のサーバー室', emoji: '🏰' },
  devops: { name: '見張り塔', emoji: '🗼' },
  infra: { name: '見張り塔', emoji: '🗼' },
  sales: { name: '賑わう市場', emoji: '🏪' },
  marketing: { name: 'のろしの丘', emoji: '📢' },
  hr: { name: 'おもてなしの館', emoji: '🏛️' },
  lunch: { name: 'おひるごはんの丘', emoji: '🍙' },
  food: { name: 'おいしいキッチン', emoji: '🍳' },
  music: { name: '音楽の泉', emoji: '🎵' },
  game: { name: 'ゲームの洞窟', emoji: '🎮' },
  gaming: { name: 'ゲームの洞窟', emoji: '🎮' },
  book: { name: '本の図書館', emoji: '📚' },
  reading: { name: '本の図書館', emoji: '📚' },
  pet: { name: 'もふもふの牧場', emoji: '🐾' },
  pets: { name: 'もふもふの牧場', emoji: '🐾' },
  fitness: { name: 'トレーニングの森', emoji: '💪' },
  health: { name: 'いやしの泉', emoji: '🌿' },
  travel: { name: '冒険者ギルド', emoji: '🗺️' },
  photo: { name: '光のギャラリー', emoji: '📷' },
  movie: { name: '星空シアター', emoji: '🎬' },
  anime: { name: '星空シアター', emoji: '🎬' },
  help: { name: 'よろず相談所', emoji: '🆘' },
  support: { name: 'よろず相談所', emoji: '🆘' },
  announcement: { name: 'お知らせの鐘楼', emoji: '🔔' },
  news: { name: 'お知らせの鐘楼', emoji: '🔔' },
}

/** Fallback locations for channels with no keyword match */
const FALLBACK_LOCATIONS = [
  { name: 'ひみつの小道', emoji: '🌿' },
  { name: '風の通り道', emoji: '🍃' },
  { name: '光の広場', emoji: '✨' },
  { name: 'おさんぽ道', emoji: '🛤️' },
  { name: '小さな丘', emoji: '⛰️' },
]

export interface ChannelLocation {
  channelId: string
  channelName: string
  locationName: string
  locationEmoji: string
  topic?: string
}

/**
 * Convert a Slack channel name to a fantasy location.
 * Uses keyword matching against known channel patterns.
 */
export function channelToLocation(
  channelId: string,
  channelName: string,
  topic?: string,
): ChannelLocation {
  const normalizedName = channelName.toLowerCase().replace(/[-_]/g, '')

  // Try exact/partial keyword match
  for (const [keyword, location] of Object.entries(CHANNEL_LOCATION_MAP)) {
    if (normalizedName.includes(keyword)) {
      return {
        channelId,
        channelName,
        locationName: location.name,
        locationEmoji: location.emoji,
        topic,
      }
    }
  }

  // Deterministic fallback based on channel name hash
  const hash = simpleHash(channelName)
  const fallback = FALLBACK_LOCATIONS[hash % FALLBACK_LOCATIONS.length]

  return {
    channelId,
    channelName,
    locationName: `${channelName}の${fallback.name}`,
    locationEmoji: fallback.emoji,
    topic,
  }
}

/**
 * Pick a random location from a list of channels for an encounter.
 */
export function pickEncounterLocation(
  sharedChannels: ChannelLocation[],
): ChannelLocation | null {
  if (sharedChannels.length === 0) return null
  return sharedChannels[Math.floor(Math.random() * sharedChannels.length)]
}

/** Simple string hash for deterministic fallback selection */
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Convert to 32-bit integer
  }
  return Math.abs(hash)
}
