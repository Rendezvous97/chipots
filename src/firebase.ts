import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth'
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  onDisconnect,
  get,
  type Database,
  type DatabaseReference,
} from 'firebase/database'
import type { DeviceState, Inventory, RoomState, TokenState } from './types'
import { cellKey, colorForIndex, nextSeat } from './game/world'
import { emptyRoom } from './localStore'
import {
  fetchJoinOrigin,
  wsAttachNeighbor,
  wsAttachPresence,
  wsCreateRoom,
  wsJoinRoom,
  wsMoveDevice,
  wsSetDeviceStatus,
  wsSubscribeRoom,
  wsWatchRoom,
  wsWriteToken,
  wsCollect,
  wsHello,
  wsTradeOffer,
  wsTradeRespond,
} from './wsStore'

let app: FirebaseApp | null = null
let db: Database | null = null
let auth: Auth | null = null
let authReady: Promise<void> | null = null

export function isFirebaseConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_DATABASE_URL,
  )
}

function getDb(): Database {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured.')
  }
  if (!app) {
    app = initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    })
    db = getDatabase(app)
    auth = getAuth(app)
  }
  if (!db) throw new Error('Database failed to initialize')
  return db
}

async function ensureAuth(): Promise<void> {
  if (!isFirebaseConfigured()) return
  getDb()
  if (!auth) return
  if (auth.currentUser) return
  if (!authReady) {
    authReady = signInAnonymously(auth).then(() => undefined)
  }
  await authReady
}

function roomRef(code: string): DatabaseReference {
  return ref(getDb(), `rooms/${code}`)
}

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
    const id =
      crypto.randomUUID?.() ?? `dev-${Math.random().toString(36).slice(2, 10)}`
    sessionStorage.setItem(key, id)
    return id
  } catch {
    return `dev-${Math.random().toString(36).slice(2, 10)}`
  }
}

export { fetchJoinOrigin }

export async function createRoom(code: string, deviceId: string): Promise<void> {
  if (isFirebaseConfigured()) {
    await ensureAuth()
    const room = emptyRoom(deviceId)
    room.devices[deviceId] = {
      worldX: 0,
      worldY: 0,
      status: 'table',
      joinedAt: Date.now(),
      color: colorForIndex(0),
    }
    await set(roomRef(code), room)
    return
  }
  await wsCreateRoom(code, deviceId)
}

export async function joinRoom(code: string, deviceId: string): Promise<void> {
  if (isFirebaseConfigured()) {
    await ensureAuth()
    const snap = await get(roomRef(code))
    const snapshot = (snap.val() as RoomState | null) ?? null
    if (!snapshot) {
      throw new Error('Room not found')
    }

    if (snapshot.devices?.[deviceId]) {
      await set(ref(getDb(), `rooms/${code}/devices/${deviceId}/status`), 'table')
      return
    }

    const seat = nextSeat(snapshot.devices ?? {})
    const index = Object.keys(snapshot.devices ?? {}).length
    const device: DeviceState = {
      worldX: seat.x,
      worldY: seat.y,
      status: 'table',
      joinedAt: Date.now(),
      color: colorForIndex(index),
    }
    await update(roomRef(code), {
      [`devices/${deviceId}`]: device,
      [`explored/${cellKey(seat.x, seat.y)}`]: true,
    })
    return
  }
  await wsJoinRoom(code, deviceId)
}

export async function attachPresence(code: string, deviceId: string): Promise<void> {
  if (isFirebaseConfigured()) {
    await ensureAuth()
    await onDisconnect(ref(getDb(), `rooms/${code}/devices/${deviceId}`)).remove()
    return
  }
  await wsAttachPresence()
}

export function subscribeRoom(
  code: string,
  onRoom: (room: RoomState | null) => void,
): () => void {
  if (isFirebaseConfigured()) {
    return onValue(roomRef(code), (snap) => {
      onRoom((snap.val() as RoomState | null) ?? null)
    })
  }
  return wsSubscribeRoom(code, onRoom)
}

export async function watchRoom(code: string): Promise<void> {
  if (isFirebaseConfigured()) {
    await ensureAuth()
    const snap = await get(roomRef(code))
    if (!snap.exists()) throw new Error('Room not found')
    return
  }
  await wsWatchRoom(code)
}

export async function setDeviceStatus(
  code: string,
  deviceId: string,
  status: DeviceState['status'],
): Promise<void> {
  if (isFirebaseConfigured()) {
    await set(ref(getDb(), `rooms/${code}/devices/${deviceId}/status`), status)
    return
  }
  await wsSetDeviceStatus(code, deviceId, status)
}

export async function moveDevice(
  code: string,
  deviceId: string,
  worldX: number,
  worldY: number,
): Promise<void> {
  if (isFirebaseConfigured()) {
    await update(roomRef(code), {
      [`devices/${deviceId}/worldX`]: worldX,
      [`devices/${deviceId}/worldY`]: worldY,
      [`devices/${deviceId}/status`]: 'table',
      [`explored/${cellKey(worldX, worldY)}`]: true,
    })
    return
  }
  await wsMoveDevice(code, deviceId, worldX, worldY)
}

export async function writeToken(code: string, token: TokenState): Promise<void> {
  if (isFirebaseConfigured()) {
    await set(ref(getDb(), `rooms/${code}/token`), token)
    return
  }
  await wsWriteToken(code, token)
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

export async function attachNeighbor(
  code: string,
  deviceId: string,
  dx: number,
  dy: number,
): Promise<void> {
  if (isFirebaseConfigured()) {
    const snap = await get(roomRef(code))
    const room = snap.val() as RoomState | null
    if (!room) return
    const liftedId = Object.keys(room.devices ?? {}).find(
      (id) => room.devices[id].status === 'lifted',
    )
    const anchor = room.devices[deviceId]
    if (!liftedId || !anchor) return
    const worldX = anchor.worldX + dx
    const worldY = anchor.worldY + dy
    await update(roomRef(code), {
      [`devices/${liftedId}/worldX`]: worldX,
      [`devices/${liftedId}/worldY`]: worldY,
      [`devices/${liftedId}/status`]: 'table',
      [`explored/${cellKey(worldX, worldY)}`]: true,
    })
    return
  }
  await wsAttachNeighbor(dx, dy)
}
