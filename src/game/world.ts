import type { BiomeId, Cell, DeviceState } from '../types'

export const DIRS: { name: 'E' | 'W' | 'N' | 'S'; dx: number; dy: number }[] = [
  { name: 'E', dx: 1, dy: 0 },
  { name: 'W', dx: -1, dy: 0 },
  { name: 'N', dx: 0, dy: -1 },
  { name: 'S', dx: 0, dy: 1 },
]

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

export function occupiedCells(
  devices: Record<string, DeviceState>,
  opts?: { excludeId?: string; tableOnly?: boolean },
): Set<string> {
  const cells = new Set<string>()
  for (const [id, device] of Object.entries(devices)) {
    if (opts?.excludeId && id === opts.excludeId) continue
    if (opts?.tableOnly && device.status !== 'table') continue
    cells.add(cellKey(device.worldX, device.worldY))
  }
  return cells
}

export function nextSeat(devices: Record<string, DeviceState>): Cell {
  const all = occupiedCells(devices)
  if (all.size === 0) return { x: 0, y: 0 }

  const table = occupiedCells(devices, { tableOnly: true })
  const seeds = table.size > 0 ? table : all
  const sorted = [...seeds]
    .map(parseCellKey)
    .sort((a, b) => a.y - b.y || a.x - b.x)

  for (const cell of sorted) {
    for (const dir of DIRS) {
      const nx = cell.x + dir.dx
      const ny = cell.y + dir.dy
      if (!all.has(cellKey(nx, ny))) return { x: nx, y: ny }
    }
  }

  return { x: all.size, y: 0 }
}

export function validSlots(
  devices: Record<string, DeviceState>,
  movingId: string,
): Cell[] {
  const moving = devices[movingId]
  if (!moving) return []

  const remaining = occupiedCells(devices, {
    excludeId: movingId,
    tableOnly: true,
  })
  const original = { x: moving.worldX, y: moving.worldY }
  const found = new Map<string, Cell>()
  found.set(cellKey(original.x, original.y), original)

  if (remaining.size === 0) return [original]

  for (const key of remaining) {
    const cell = parseCellKey(key)
    for (const dir of DIRS) {
      const nx = cell.x + dir.dx
      const ny = cell.y + dir.dy
      const nkey = cellKey(nx, ny)
      if (remaining.has(nkey)) continue
      found.set(nkey, { x: nx, y: ny })
    }
  }

  return [...found.values()]
}

export function snapToMotion(
  slots: Cell[],
  origin: Cell,
  motionX: number,
  motionY: number,
  stayThreshold: number,
): Cell {
  const dist = Math.hypot(motionX, motionY)
  if (dist < stayThreshold) {
    const stay = slots.find((s) => s.x === origin.x && s.y === origin.y)
    return stay ?? origin
  }

  // Device-frame: +motionX is toward the right of the phone (east if all tops
  // point the same way). +motionY is toward the top of the phone (north).
  const dirX = motionX
  const dirY = -motionY
  let best = origin
  let bestDot = -Infinity
  for (const slot of slots) {
    const vx = slot.x - origin.x
    const vy = slot.y - origin.y
    const mag = Math.hypot(vx, vy) || 1
    const nx = vx / mag
    const ny = vy / mag
    const dot = nx * dirX + ny * dirY
    if (dot > bestDot) {
      bestDot = dot
      best = slot
    }
  }
  return best
}

export function tokenInViewport(
  tokenX: number,
  tokenY: number,
  worldX: number,
  worldY: number,
): boolean {
  return (
    tokenX >= worldX &&
    tokenX < worldX + 1 &&
    tokenY >= worldY &&
    tokenY < worldY + 1
  )
}

export function phoneAtCell(
  devices: Record<string, DeviceState>,
  cellX: number,
  cellY: number,
): boolean {
  for (const device of Object.values(devices)) {
    if (device.status !== 'table') continue
    if (device.worldX === cellX && device.worldY === cellY) return true
  }
  return false
}

export function slotLabel(
  slot: Cell,
  origin: Cell,
  devices: Record<string, DeviceState>,
  movingId: string,
): string {
  if (slot.x === origin.x && slot.y === origin.y) return 'Stay'

  const remaining = occupiedCells(devices, {
    excludeId: movingId,
    tableOnly: true,
  })
  let nearest: Cell = origin
  let best = Infinity
  for (const key of remaining) {
    const cell = parseCellKey(key)
    const d = Math.hypot(slot.x - cell.x, slot.y - cell.y)
    if (d < best) {
      best = d
      nearest = cell
    }
  }
  const dx = slot.x - nearest.x
  const dy = slot.y - nearest.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'E' : 'W'
  return dy > 0 ? 'S' : 'N'
}

export const DEVICE_COLORS = [
  '#e31c3d',
  '#f5c518',
  '#00d4ff',
  '#7c4dff',
  '#00e676',
  '#ff6d00',
  '#f50057',
]

export function colorForIndex(index: number): string {
  return DEVICE_COLORS[index % DEVICE_COLORS.length]
}
