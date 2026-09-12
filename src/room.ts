import type { Inventory, RoomState } from './types'
import {
  fetchJoinOrigin,
  wsAttachPresence,
  wsCollect,
  wsCreateRoom,
  wsHello,
  wsJoinRoom,
  wsSubscribeRoom,
  wsTradeOffer,
  wsTradeRespond,
  wsWatchRoom,
} from './wsStore'

export { fetchJoinOrigin }

export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return code
}

export function getDeviceId(): string {
  const key = 'tabletop-device-id'
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('device')
    if (fromUrl) {
      sessionStorage.setItem(key, fromUrl)
      return fromUrl
    }
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const id = crypto.randomUUID?.() ?? `dev-${Math.random().toString(36).slice(2, 10)}`
    sessionStorage.setItem(key, id)
    return id
  } catch {
    return `dev-${Math.random().toString(36).slice(2, 10)}`
  }
}

export async function createRoom(code: string, _deviceId?: string): Promise<void> {
  await wsCreateRoom(code)
}

export async function joinRoom(code: string, deviceId: string): Promise<void> {
  await wsJoinRoom(code, deviceId)
}

export async function attachPresence(_code?: string, _deviceId?: string): Promise<void> {
  await wsAttachPresence()
}

export function subscribeRoom(
  code: string,
  onRoom: (room: RoomState | null) => void,
): () => void {
  return wsSubscribeRoom(code, onRoom)
}

export async function watchRoom(code: string): Promise<void> {
  await wsWatchRoom(code)
}

export function collectResource(key: string, cellX: number, cellY: number) {
  wsCollect(key, cellX, cellY)
}

export function sayHello(name: string) {
  wsHello(name)
}

export function offerTrade(toId: string, offer: Inventory, ask: Inventory) {
  wsTradeOffer(toId, offer, ask)
}

export function respondTrade(tradeId: string, accept: boolean) {
  wsTradeRespond(tradeId, accept)
}
