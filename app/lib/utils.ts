import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Pick a random element from an array
 * @throws Error if the array is empty
 */
export function pickRandom<T>(arr: readonly T[]): T {
  if (arr.length === 0) {
    throw new Error('Cannot pick from an empty array')
  }
  return arr[Math.floor(Math.random() * arr.length)]
}
