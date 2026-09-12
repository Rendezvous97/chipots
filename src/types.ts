export type DeviceStatus = 'table' | 'lifted'

export type BiomeId =
  | 'village'
  | 'forest'
  | 'river'
  | 'plains'
  | 'mountain'
  | 'volcano'
  | 'cave'
  | 'ocean'

export type Inventory = {
  sheep: number
  wheat: number
  clay: number
  stone: number
}

export type DeviceState = {
  worldX: number
  worldY: number
  status: DeviceStatus
  joinedAt: number
  color: string
  inventory?: Inventory
  name?: string
}

export type TokenState = {
  x: number
  y: number
  vx: number
  vy: number
}

export type UwbPublic = {
  originId: string | null
  rightId: string | null
  gx: number
  gy: number
  calibrated?: boolean
  needSnap?: boolean
  movingId?: string | null
  ranges?: Record<string, number>
  bearings?: Record<string, { x: number; y: number; compass: string }>
}

export type Goods = Inventory

export type TradeOffer = {
  id: string
  from: string
  to: string
  offer: Goods
  ask: Goods
  status: 'pending' | 'done' | 'declined' | 'failed'
}

export type RoomState = {
  hostId: string
  createdAt: number
  worldSeed: number
  collected: Record<string, string>
  trades?: Record<string, TradeOffer>
  winnerId?: string | null
  devices: Record<string, DeviceState>
  explored: Record<string, boolean>
  token: TokenState
  uwb?: UwbPublic
}

export type Cell = { x: number; y: number }
