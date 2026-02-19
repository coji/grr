/**
 * Japanese seasonal events for proactive greetings
 *
 * These are traditional Japanese calendar events and modern holidays
 * that can be used for seasonal greetings.
 */

export interface SeasonalEvent {
  name: string
  month: number
  day: number
  type: 'traditional' | 'holiday' | 'modern'
}

/**
 * Get seasonal events for a specific date
 */
export function getSeasonalEventsForDate(
  month: number,
  day: number,
): SeasonalEvent[] {
  return SEASONAL_EVENTS.filter((e) => e.month === month && e.day === day)
}

/**
 * Get the next upcoming seasonal event within N days
 */
export function getUpcomingSeasonalEvent(
  currentMonth: number,
  currentDay: number,
  withinDays: number = 0,
): SeasonalEvent | undefined {
  // Check today first
  const todayEvents = getSeasonalEventsForDate(currentMonth, currentDay)
  if (todayEvents.length > 0) {
    return todayEvents[0]
  }

  // Check upcoming days
  for (let i = 1; i <= withinDays; i++) {
    // Simple date calculation (not handling month boundaries perfectly, but good enough)
    const date = new Date(2024, currentMonth - 1, currentDay + i)
    const events = getSeasonalEventsForDate(date.getMonth() + 1, date.getDate())
    if (events.length > 0) {
      return events[0]
    }
  }

  return undefined
}

const SEASONAL_EVENTS: SeasonalEvent[] = [
  // 二十四節気 (24 Solar Terms) - approximate dates
  { name: '小寒', month: 1, day: 5, type: 'traditional' },
  { name: '大寒', month: 1, day: 20, type: 'traditional' },
  { name: '立春', month: 2, day: 4, type: 'traditional' },
  { name: '雨水', month: 2, day: 19, type: 'traditional' },
  { name: '啓蟄', month: 3, day: 6, type: 'traditional' },
  { name: '春分', month: 3, day: 21, type: 'traditional' },
  { name: '清明', month: 4, day: 5, type: 'traditional' },
  { name: '穀雨', month: 4, day: 20, type: 'traditional' },
  { name: '立夏', month: 5, day: 6, type: 'traditional' },
  { name: '小満', month: 5, day: 21, type: 'traditional' },
  { name: '芒種', month: 6, day: 6, type: 'traditional' },
  { name: '夏至', month: 6, day: 21, type: 'traditional' },
  { name: '小暑', month: 7, day: 7, type: 'traditional' },
  { name: '大暑', month: 7, day: 23, type: 'traditional' },
  { name: '立秋', month: 8, day: 8, type: 'traditional' },
  { name: '処暑', month: 8, day: 23, type: 'traditional' },
  { name: '白露', month: 9, day: 8, type: 'traditional' },
  { name: '秋分', month: 9, day: 23, type: 'traditional' },
  { name: '寒露', month: 10, day: 8, type: 'traditional' },
  { name: '霜降', month: 10, day: 24, type: 'traditional' },
  { name: '立冬', month: 11, day: 8, type: 'traditional' },
  { name: '小雪', month: 11, day: 22, type: 'traditional' },
  { name: '大雪', month: 12, day: 7, type: 'traditional' },
  { name: '冬至', month: 12, day: 22, type: 'traditional' },

  // 日本の祝日・行事 (Japanese holidays and events)
  { name: '元日', month: 1, day: 1, type: 'holiday' },
  { name: '成人の日', month: 1, day: 8, type: 'holiday' }, // 2nd Monday approximation
  { name: '節分', month: 2, day: 3, type: 'traditional' },
  { name: 'バレンタインデー', month: 2, day: 14, type: 'modern' },
  { name: 'ひな祭り', month: 3, day: 3, type: 'traditional' },
  { name: 'ホワイトデー', month: 3, day: 14, type: 'modern' },
  { name: 'エイプリルフール', month: 4, day: 1, type: 'modern' },
  { name: '昭和の日', month: 4, day: 29, type: 'holiday' },
  { name: 'こどもの日', month: 5, day: 5, type: 'holiday' },
  { name: '母の日', month: 5, day: 12, type: 'modern' }, // 2nd Sunday approximation
  { name: '父の日', month: 6, day: 16, type: 'modern' }, // 3rd Sunday approximation
  { name: '七夕', month: 7, day: 7, type: 'traditional' },
  { name: '海の日', month: 7, day: 15, type: 'holiday' }, // 3rd Monday approximation
  { name: '山の日', month: 8, day: 11, type: 'holiday' },
  { name: 'お盆', month: 8, day: 15, type: 'traditional' },
  { name: '敬老の日', month: 9, day: 16, type: 'holiday' }, // 3rd Monday approximation
  { name: '十五夜', month: 9, day: 15, type: 'traditional' }, // approximate
  { name: 'ハロウィン', month: 10, day: 31, type: 'modern' },
  { name: '文化の日', month: 11, day: 3, type: 'holiday' },
  { name: '七五三', month: 11, day: 15, type: 'traditional' },
  { name: '勤労感謝の日', month: 11, day: 23, type: 'holiday' },
  { name: 'クリスマスイブ', month: 12, day: 24, type: 'modern' },
  { name: 'クリスマス', month: 12, day: 25, type: 'modern' },
  { name: '大晦日', month: 12, day: 31, type: 'traditional' },

  // 年度の節目
  { name: '年度始め', month: 4, day: 1, type: 'modern' },
]
