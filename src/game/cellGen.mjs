/**
 * Each cell is one authored background (Frames + grass). Ponds, trees, and
 * dirt are already painted in those tiles. Only collectibles are extra.
 */

export const RESOURCE_KINDS = ['sheep', 'wheat', 'clay', 'stone']

const BACKGROUNDS = ['grass', 'frame3', 'frame4', 'frame5', 'frame6', 'frame7']

function mix(x, y, seed) {
  let h = (seed >>> 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return h >>> 0
}

function rng(start) {
  let h = start >>> 0
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822519)
    h = Math.imul(h ^ (h >>> 13), 3266489917)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

function pickBackground(u) {
  if (u < 0.22) return 'grass'
  if (u < 0.4) return 'frame3'
  if (u < 0.58) return 'frame5'
  if (u < 0.72) return 'frame4'
  if (u < 0.86) return 'frame6'
  return 'frame7'
}

export function resourceKey(x, y, kind, slot) {
  return `${x},${y}:${kind}:${slot}`
}

export function tagsForBackground(background) {
  if (background === 'frame3') return { dirt: false, water: false, grass: true, rock: true }
  if (background === 'frame5') return { dirt: true, water: false, grass: true, rock: false }
  if (background === 'frame4' || background === 'frame6' || background === 'frame7') {
    return { dirt: false, water: true, grass: true, rock: false }
  }
  return { dirt: false, water: false, grass: true, rock: false }
}

function densityFor(background) {
  if (background === 'grass') return 'empty'
  if (background === 'frame3' || background === 'frame5') return 'medium'
  return 'dense'
}

function place(kind, rand, others, scale, x, y) {
  let px = x
  let py = y
  if (px == null || py == null) {
    for (let i = 0; i < 10; i++) {
      px = 0.28 + rand() * 0.44
      py = 0.28 + rand() * 0.44
      const hit = others.some((p) => Math.hypot(p.x - px, p.y - py) < 0.2)
      if (!hit) break
    }
  }
  return { kind, layer: 'resource', x: px, y: py, scale }
}

function grassSpots(background) {
  if (background === 'frame3') return [[0.55, 0.42], [0.68, 0.7]]
  if (background === 'frame4') return [[0.5, 0.12], [0.72, 0.82]]
  if (background === 'frame5') return [[0.5, 0.22], [0.48, 0.8], [0.52, 0.48]]
  if (background === 'frame6') return [[0.45, 0.16], [0.7, 0.22]]
  if (background === 'frame7') return [[0.55, 0.52], [0.62, 0.74]]
  return [[0.35, 0.4], [0.65, 0.55], [0.5, 0.72]]
}

function lootFor(background, rand) {
  if (background === 'frame3') return rand() < 0.85 ? ['stone', rand() < 0.45 ? 'stone' : null] : ['stone']
  if (background === 'frame5') return ['clay', rand() < 0.55 ? 'clay' : rand() < 0.4 ? 'stone' : null]
  if (background === 'frame4' || background === 'frame6') return rand() < 0.35 ? ['stone'] : []
  if (background === 'frame7') return rand() < 0.7 ? ['sheep', rand() < 0.4 ? 'wheat' : null] : ['wheat']
  const kinds = []
  if (rand() < 0.55) kinds.push('sheep')
  if (rand() < 0.5) kinds.push('wheat')
  if (rand() < 0.35) kinds.push('stone')
  if (kinds.length === 0 && rand() < 0.4) kinds.push('wheat')
  return kinds
}

export function generateCell(cellX, cellY, seed) {
  const rand = rng(mix(cellX, cellY, seed))
  const background = pickBackground(rand())
  const tags = tagsForBackground(background)
  const density = densityFor(background)
  const spots = grassSpots(background)
  const loot = lootFor(background, rand).filter(Boolean)
  const resources = []
  for (let i = 0; i < loot.length; i++) {
    const [sx, sy] = spots[i % spots.length]
    const jitterX = (rand() - 0.5) * 0.08
    const jitterY = (rand() - 0.5) * 0.08
    resources.push({
      ...place(loot[i], rand, resources, 0.28 + rand() * 0.08, sx + jitterX, sy + jitterY),
      key: resourceKey(cellX, cellY, loot[i], i),
    })
  }
  return {
    density,
    grassVariant: 0,
    background,
    special: background === 'grass' ? null : background,
    props: [],
    resources,
    tags,
  }
}

export function cellObjectCount(view) {
  return view.resources.length
}

export function visibleResources(view, collected) {
  const taken = collected ?? {}
  const isTaken = (key) =>
    typeof taken.has === 'function' ? taken.has(key) : Boolean(taken[key])
  return view.resources.filter((r) => r.key && !isTaken(r.key))
}

export function hitResource(view, collected, nx, ny) {
  const list = visibleResources(view, collected)
  let best = null
  let bestD = 0.18
  for (const item of list) {
    const d = Math.hypot(item.x - nx, item.y - ny)
    const rad = Math.max(0.12, item.scale * 0.42)
    if (d <= rad && d < bestD) {
      best = item
      bestD = d
    }
  }
  return best
}

export function backgroundLabel(background) {
  if (background === 'grass') return 'Meadow'
  if (background === 'frame3') return 'Woods'
  if (background === 'frame5') return 'Clearing'
  if (background === 'frame4') return 'Pond'
  if (background === 'frame6') return 'Water'
  if (background === 'frame7') return 'Creek'
  return 'Field'
}
