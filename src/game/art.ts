export const ART: Record<string, string> = {
  grass: new URL('../assets/art/Base Layer Grass.png', import.meta.url).href,
  frame3: new URL('../assets/art/Frame 3 (2).png', import.meta.url).href,
  frame4: new URL('../assets/art/Frame 4 (2).png', import.meta.url).href,
  frame5: new URL('../assets/art/Frame 5 (1).png', import.meta.url).href,
  frame6: new URL('../assets/art/Frame 6 (1).png', import.meta.url).href,
  frame7: new URL('../assets/art/Frame 7 (3).png', import.meta.url).href,
  dirt: new URL('../assets/art/Patch of Dirt.png', import.meta.url).href,
  pond0: new URL('../assets/art/Pond.png', import.meta.url).href,
  pond1: new URL('../assets/art/Pond (1).png', import.meta.url).href,
  pond2: new URL('../assets/art/Pond (2).png', import.meta.url).href,
  tree0: new URL('../assets/art/Tree.png', import.meta.url).href,
  tree1: new URL('../assets/art/Tree (1).png', import.meta.url).href,
  tree2: new URL('../assets/art/Tree (2).png', import.meta.url).href,
  sheep: new URL('../assets/art/Sheep.png', import.meta.url).href,
  wheat: new URL('../assets/art/Wheat.png', import.meta.url).href,
  clay: new URL('../assets/art/Clay.png', import.meta.url).href,
  stone: new URL('../assets/art/Stone.png', import.meta.url).href,
}

const cache = new Map<string, HTMLImageElement>()

export function artImage(kind: string): HTMLImageElement | null {
  const src = ART[kind]
  if (!src) return null
  let img = cache.get(kind)
  if (!img) {
    img = new Image()
    img.decoding = 'async'
    img.src = src
    cache.set(kind, img)
  }
  if (!img.complete || img.naturalWidth === 0) return null
  return img
}

export function preloadArt() {
  for (const kind of Object.keys(ART)) artImage(kind)
}

export const RESOURCE_LABEL: Record<string, string> = {
  sheep: 'Sheep',
  wheat: 'Wheat',
  clay: 'Clay',
  stone: 'Stone',
}
