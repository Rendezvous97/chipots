import type { BiomeId, Cell } from '../types'

export const BIOME_STYLE: Record<
  BiomeId,
  { fill: string; accent: string; emoji: string; label: string }
> = {
  village: { fill: '#c4a574', accent: '#8a6a3b', emoji: '🏠', label: 'Village' },
  forest: { fill: '#2d5a27', accent: '#1a3d16', emoji: '🌲', label: 'Forest' },
  river: { fill: '#1a6b8a', accent: '#0e3f54', emoji: '🌊', label: 'River' },
  plains: { fill: '#7a9e4c', accent: '#4f6e2a', emoji: '🌾', label: 'Plains' },
  mountain: { fill: '#6b6b6b', accent: '#3f3f3f', emoji: '⛰️', label: 'Mountains' },
  volcano: { fill: '#8b2500', accent: '#4a1200', emoji: '🌋', label: 'Volcano' },
  cave: { fill: '#3d2b4f', accent: '#1e1528', emoji: '💎', label: 'Mine' },
  ocean: { fill: '#0b3d5c', accent: '#062536', emoji: '🌊', label: 'Ocean' },
}

const SPECIAL: Record<string, BiomeId> = {
  '0,0': 'village',
  '1,0': 'river',
  '-1,0': 'plains',
  '0,-1': 'forest',
  '0,1': 'mountain',
  '2,0': 'ocean',
  '1,-1': 'cave',
  '-1,-1': 'volcano',
  '2,-1': 'volcano',
  '-2,0': 'forest',
}

const BIOME_CYCLE: BiomeId[] = [
  'forest',
  'plains',
  'river',
  'mountain',
  'ocean',
  'cave',
  'village',
  'volcano',
]

export function cellKey(x: number, y: number): string {
  return `${x},${y}`
}

export function parseCellKey(key: string): Cell {
  const [xs, ys] = key.split(',')
  return { x: Number(xs), y: Number(ys) }
}

export function biomeAt(x: number, y: number): BiomeId {
  const special = SPECIAL[cellKey(x, y)]
  if (special) return special
  const h = Math.abs((x * 73856093) ^ (y * 19349663) ^ (x * y * 83492791))
  return BIOME_CYCLE[h % BIOME_CYCLE.length]
}
