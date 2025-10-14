export const DIARY_PERSONA_NAME = 'ほたる'

export type DiaryMoodChoice = {
  reaction: string
  emoji: string
  label: string
  value: number
}

export const DIARY_MOOD_CHOICES: DiaryMoodChoice[] = [
  { reaction: 'smile', emoji: '😄', label: 'ほっと安心', value: 3 },
  { reaction: 'neutral_face', emoji: '😐', label: 'ふつうの日', value: 2 },
  { reaction: 'tired_face', emoji: '😫', label: 'おつかれさま', value: 1 },
]

export const SUPPORTIVE_REACTIONS = [
  'sparkles',
  'heart',
  'hugging_face',
  'sunny',
  'blush',
  'stars',
]
