import type { DeviceState, RoomState, TokenState } from './types'
import { cellKey, colorForIndex, nextSeat } from './game/world'

const STORAGE_KEY = 'hackcmu-tabletop-rooms'
const channel =
  typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('hackcmu-tabletop-rooms')
    : null

type Listener = (room: RoomState | null) => void
const listeners = new Map<string, Set<Listener>>()

let memory: Record<string, RoomState> = load()

function load(): Record<string, RoomState> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<
      string,
      RoomState
    >
  } catch {
    return {}
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
  } catch {
    // Private / blocked storage; in-memory + BroadcastChannel still work.
  }
}

function notify(code: string) {
  const room = memory[code] ?? null
  listeners.get(code)?.forEach((fn) => fn(room))
}

function publish(code: string, persistRoom = true) {
  if (persistRoom) persist()
  try {
    channel?.postMessage({ type: 'room', code, room: memory[code] ?? null })
  } catch {
    /* ignore */
  }
  notify(code)
}

channel?.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { type?: string; code?: string; room?: RoomState | null }
  if (data?.type !== 'room' || !data.code) return
  if (data.room) memory[data.code] = data.room
  else delete memory[data.code]
  notify(data.code)
})

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return
  memory = load()
  for (const code of listeners.keys()) notify(code)
})

export function emptyRoom(hostId: string): RoomState {
  return {
    hostId,
    createdAt: Date.now(),
    devices: {},
    explored: { [cellKey(0, 0)]: true },
    token: { x: 0.5, y: 0.5, vx: 0.28, vy: 0 },
    worldSeed: (Math.random() * 0xffffffff) >>> 0,
    collected: {},
    trades: {},
    winnerId: null,
  }
}

export async function localCreateRoom(code: string, deviceId: string): Promise<void> {
  const room = emptyRoom(deviceId)
  room.devices[deviceId] = {
    worldX: 0,
    worldY: 0,
    status: 'table',
    joinedAt: Date.now(),
    color: colorForIndex(0),
    inventory: { sheep: 0, wheat: 0, clay: 0, stone: 0 },
  }
  memory[code] = room
  publish(code)
}

export async function localJoinRoom(code: string, deviceId: string): Promise<void> {
  const snapshot = memory[code] ?? load()[code]
  if (!snapshot) throw new Error('Room not found')
  memory[code] = snapshot
  if (snapshot.devices?.[deviceId]) {
    snapshot.devices[deviceId].status = 'table'
    publish(code)
    return
  }
  const seat = nextSeat(snapshot.devices ?? {})
  const index = Object.keys(snapshot.devices ?? {}).length
  snapshot.devices[deviceId] = {
    worldX: seat.x,
    worldY: seat.y,
    status: 'table',
    joinedAt: Date.now(),
    color: colorForIndex(index),
    inventory: { sheep: 0, wheat: 0, clay: 0, stone: 0 },
  }
  snapshot.explored = {
    ...snapshot.explored,
    [cellKey(seat.x, seat.y)]: true,
  }
  publish(code)
}

export function localSubscribeRoom(code: string, onRoom: Listener): () => void {
  const set = listeners.get(code) ?? new Set<Listener>()
  set.add(onRoom)
  listeners.set(code, set)
  onRoom(memory[code] ?? null)
  return () => {
    set.delete(onRoom)
  }
}

export async function localSetDeviceStatus(
  code: string,
  deviceId: string,
  status: DeviceState['status'],
): Promise<void> {
  const device = memory[code]?.devices[deviceId]
  if (!device) return
  device.status = status
  publish(code)
}

export async function localMoveDevice(
  code: string,
  deviceId: string,
  worldX: number,
  worldY: number,
): Promise<void> {
  const device = memory[code]?.devices[deviceId]
  if (!device || !memory[code]) return
  device.worldX = worldX
  device.worldY = worldY
  device.status = 'table'
  memory[code].explored = {
    ...memory[code].explored,
    [cellKey(worldX, worldY)]: true,
  }
  publish(code)
}

export async function localWriteToken(code: string, token: TokenState): Promise<void> {
  if (!memory[code]) return
  memory[code].token = token
  publish(code, false)
}

export async function localAttachPresence(code: string, deviceId: string): Promise<void> {
  const remove = () => {
    if (!memory[code]?.devices[deviceId]) return
    delete memory[code].devices[deviceId]
    publish(code)
  }
  window.addEventListener('pagehide', remove)
}
