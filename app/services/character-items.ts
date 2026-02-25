/**
 * Character item definitions and discovery logic.
 *
 * Items are abstract, cute collectibles with no connection to diary content.
 * Characters find items randomly and can gift them to other characters.
 */

import { nanoid } from 'nanoid'
import dayjs from '~/lib/dayjs'
import { db } from './db'

// ============================================
// Item Catalog
// ============================================

interface ItemDefinition {
  id: string
  name: string
  emoji: string
  category: 'nature' | 'food' | 'craft' | 'treasure'
  rarity: 'common' | 'uncommon' | 'rare'
}

const ITEM_CATALOG: ItemDefinition[] = [
  // Nature
  {
    id: 'shiny_stone',
    name: '光る石',
    emoji: '💎',
    category: 'nature',
    rarity: 'common',
  },
  {
    id: 'four_leaf',
    name: '四つ葉のクローバー',
    emoji: '🍀',
    category: 'nature',
    rarity: 'uncommon',
  },
  {
    id: 'pretty_shell',
    name: 'きれいな貝殻',
    emoji: '🐚',
    category: 'nature',
    rarity: 'common',
  },
  {
    id: 'feather',
    name: 'ふわふわの羽',
    emoji: '🪶',
    category: 'nature',
    rarity: 'common',
  },
  {
    id: 'acorn',
    name: 'まんまるどんぐり',
    emoji: '🌰',
    category: 'nature',
    rarity: 'common',
  },
  {
    id: 'flower',
    name: 'ちいさな花',
    emoji: '🌸',
    category: 'nature',
    rarity: 'common',
  },
  {
    id: 'rainbow_stone',
    name: '虹色の石',
    emoji: '🌈',
    category: 'nature',
    rarity: 'rare',
  },
  {
    id: 'star_sand',
    name: '星の砂',
    emoji: '⭐',
    category: 'nature',
    rarity: 'rare',
  },

  // Food
  {
    id: 'candy',
    name: 'あめちゃん',
    emoji: '🍬',
    category: 'food',
    rarity: 'common',
  },
  {
    id: 'cookie',
    name: '手作りクッキー',
    emoji: '🍪',
    category: 'food',
    rarity: 'common',
  },
  {
    id: 'fruit',
    name: '甘い木の実',
    emoji: '🫐',
    category: 'food',
    rarity: 'common',
  },
  {
    id: 'honey',
    name: 'はちみつ',
    emoji: '🍯',
    category: 'food',
    rarity: 'uncommon',
  },
  {
    id: 'chocolate',
    name: 'とっておきチョコ',
    emoji: '🍫',
    category: 'food',
    rarity: 'uncommon',
  },

  // Craft
  {
    id: 'bracelet',
    name: '手編みのミサンガ',
    emoji: '🧶',
    category: 'craft',
    rarity: 'uncommon',
  },
  {
    id: 'drawing',
    name: 'お絵かき',
    emoji: '🖼️',
    category: 'craft',
    rarity: 'common',
  },
  {
    id: 'origami',
    name: '折り紙',
    emoji: '📄',
    category: 'craft',
    rarity: 'common',
  },
  {
    id: 'music_box',
    name: 'オルゴール',
    emoji: '🎵',
    category: 'craft',
    rarity: 'rare',
  },

  // Treasure
  {
    id: 'old_coin',
    name: 'ふるいコイン',
    emoji: '🪙',
    category: 'treasure',
    rarity: 'uncommon',
  },
  {
    id: 'tiny_crown',
    name: 'ちいさな王冠',
    emoji: '👑',
    category: 'treasure',
    rarity: 'rare',
  },
  {
    id: 'magic_key',
    name: 'ふしぎなカギ',
    emoji: '🗝️',
    category: 'treasure',
    rarity: 'rare',
  },
]

const RARITY_WEIGHTS = {
  common: 0.6,
  uncommon: 0.3,
  rare: 0.1,
} as const

/** Daily probability of finding an item when writing a diary entry */
const ITEM_DISCOVERY_CHANCE = 0.35

/** Maximum items a user can hold (ungifted) */
const MAX_HELD_ITEMS = 10

// ============================================
// Item Discovery
// ============================================

/**
 * Attempt to discover a random item for a character.
 * Called when a user writes a diary entry.
 * Returns the discovered item or null if no discovery.
 */
export async function tryDiscoverItem(
  userId: string,
  workspaceId: string,
): Promise<ItemDefinition | null> {
  // Check probability
  if (Math.random() > ITEM_DISCOVERY_CHANCE) return null

  // Check if user already has too many items
  const heldCount = await db
    .selectFrom('characterItems')
    .where('ownerUserId', '=', userId)
    .where('giftedToUserId', 'is', null)
    .select(db.fn.countAll().as('count'))
    .executeTakeFirstOrThrow()

  if (Number(heldCount.count) >= MAX_HELD_ITEMS) return null

  // Pick a random item based on rarity weights
  const item = pickRandomItem()

  // Store the item
  const now = dayjs().utc().toISOString()
  await db
    .insertInto('characterItems')
    .values({
      id: nanoid(),
      ownerUserId: userId,
      workspaceId,
      itemId: item.id,
      itemName: item.name,
      itemEmoji: item.emoji,
      itemCategory: item.category,
      itemDescription: null,
      foundAt: now,
      receivedFromUserId: null,
      giftedToUserId: null,
      giftedAt: null,
    })
    .execute()

  return item
}

/**
 * Gift an item to another character in the same workspace.
 */
export async function giftItem(
  itemDbId: string,
  fromUserId: string,
  toUserId: string,
): Promise<boolean> {
  const now = dayjs().utc().toISOString()

  const result = await db
    .updateTable('characterItems')
    .set({
      giftedToUserId: toUserId,
      giftedAt: now,
    })
    .where('id', '=', itemDbId)
    .where('ownerUserId', '=', fromUserId)
    .where('giftedToUserId', 'is', null)
    .execute()

  // Create a copy for the recipient
  if (result[0]?.numUpdatedRows > 0n) {
    const original = await db
      .selectFrom('characterItems')
      .selectAll()
      .where('id', '=', itemDbId)
      .executeTakeFirst()

    if (original) {
      await db
        .insertInto('characterItems')
        .values({
          id: nanoid(),
          ownerUserId: toUserId,
          workspaceId: original.workspaceId,
          itemId: original.itemId,
          itemName: original.itemName,
          itemEmoji: original.itemEmoji,
          itemCategory: original.itemCategory,
          itemDescription: null,
          foundAt: now,
          receivedFromUserId: fromUserId,
          giftedToUserId: null,
          giftedAt: null,
        })
        .execute()
    }
    return true
  }

  return false
}

/**
 * Get items held by a user (not yet gifted away).
 */
export async function getHeldItems(userId: string) {
  return db
    .selectFrom('characterItems')
    .selectAll()
    .where('ownerUserId', '=', userId)
    .where('giftedToUserId', 'is', null)
    .orderBy('foundAt', 'desc')
    .execute()
}

/**
 * Get recent gifts received by a user.
 */
export async function getReceivedGifts(userId: string, limit = 5) {
  return db
    .selectFrom('characterItems')
    .selectAll()
    .where('ownerUserId', '=', userId)
    .where('receivedFromUserId', 'is not', null)
    .orderBy('foundAt', 'desc')
    .limit(limit)
    .execute()
}

/**
 * Get an item definition by ID.
 */
export function getItemDefinition(itemId: string): ItemDefinition | undefined {
  return ITEM_CATALOG.find((item) => item.id === itemId)
}

// ============================================
// Helpers
// ============================================

function pickRandomItem(): ItemDefinition {
  const roll = Math.random()
  let targetRarity: 'common' | 'uncommon' | 'rare'

  if (roll < RARITY_WEIGHTS.common) {
    targetRarity = 'common'
  } else if (roll < RARITY_WEIGHTS.common + RARITY_WEIGHTS.uncommon) {
    targetRarity = 'uncommon'
  } else {
    targetRarity = 'rare'
  }

  const candidates = ITEM_CATALOG.filter((item) => item.rarity === targetRarity)
  return candidates[Math.floor(Math.random() * candidates.length)]
}
