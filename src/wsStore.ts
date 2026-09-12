import type { DeviceState, Inventory, RoomState, TokenState } from './types'

type Listener = (room: RoomState | null) => void
type Outgoing =
  | { type: 'join'; code: string; deviceId: string; createIfMissing?: boolean; native?: boolean }
  | { type: 'watch'; code: string; createIfMissing?: boolean }
  | { type: 'status'; status: DeviceState['status'] }
  | { type: 'move'; worldX: number; worldY: number }
  | { type: 'attach'; dx: number; dy: number }
  | { type: 'token'; token: TokenState }
  | { type: 'collect'; key: string; cellX: number; cellY: number }
  | { type: 'hello'; name: string }
  | { type: 'trade-offer'; toId: string; offer: Inventory; ask: Inventory }
  | { type: 'trade-respond'; tradeId: string; accept: boolean }

const listeners = new Map<string, Set<Listener>>()
const lastRoom = new Map<string, RoomState | null>()
let socket: WebSocket | null = null
let socketReady: Promise<WebSocket> | null = null
const queue: Outgoing[] = []

function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

function notify(code: string, room: RoomState | null) {
  lastRoom.set(code, room)
  listeners.get(code)?.forEach((fn) => fn(room))
}

function flush(ws: WebSocket) {
  while (queue.length > 0 && ws.readyState === WebSocket.OPEN) {
    const msg = queue.shift()
    if (msg) ws.send(JSON.stringify(msg))
  }
}

function send(msg: Outgoing) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg))
    return
  }
  queue.push(msg)
  void ensureSocket()
}

function ensureSocket(): Promise<WebSocket> {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket)
  if (socketReady) return socketReady

  socketReady = new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl())
    const timer = window.setTimeout(() => {
      reject(new Error('Could not reach the game server. Run npm run dev on the laptop.'))
    }, 8000)

    ws.addEventListener('open', () => {
      window.clearTimeout(timer)
      socket = ws
      flush(ws)
      resolve(ws)
    })
    ws.addEventListener('error', () => {
      window.clearTimeout(timer)
      socketReady = null
      reject(new Error('Could not reach the game server. Run npm run dev on the laptop.'))
    })
    ws.addEventListener('close', () => {
      socket = null
      socketReady = null
    })
    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(String(event.data)) as {
          type: string
          code?: string
          room?: RoomState | null
          message?: string
        }
        if (data.type === 'state' && data.code) {
          notify(data.code, data.room ?? null)
        }
        if (data.type === 'error') {
          errorWaiters.forEach((fn) => fn(data.message ?? 'Room error'))
          errorWaiters.clear()
        }
      } catch {
        /* ignore */
      }
    })
  })

  return socketReady
}

const errorWaiters = new Set<(message: string) => void>()

function waitForRoom(code: string, deviceId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Timed out joining room'))
    }, 8000)

    const onError = (message: string) => {
      cleanup()
      reject(new Error(message))
    }
    errorWaiters.add(onError)

    const onState: Listener = (room) => {
      if (room?.devices[deviceId]) {
        cleanup()
        resolve()
      }
    }
    const set = listeners.get(code) ?? new Set<Listener>()
    set.add(onState)
    listeners.set(code, set)

    function cleanup() {
      window.clearTimeout(timeout)
      errorWaiters.delete(onError)
      set.delete(onState)
    }
  })
}

export async function wsCreateRoom(code: string, _deviceId?: string): Promise<void> {
  await ensureSocket()
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Timed out creating room'))
    }, 8000)
    const onError = (message: string) => {
      cleanup()
      reject(new Error(message))
    }
    errorWaiters.add(onError)
    const onState: Listener = (room) => {
      if (room) {
        cleanup()
        resolve()
      }
    }
    const set = listeners.get(code) ?? new Set<Listener>()
    set.add(onState)
    listeners.set(code, set)
    function cleanup() {
      window.clearTimeout(timeout)
      errorWaiters.delete(onError)
      set.delete(onState)
    }
  })
  send({ type: 'watch', code, createIfMissing: true })
  await ready
}

export async function wsJoinRoom(code: string, deviceId: string): Promise<void> {
  await ensureSocket()
  const joined = waitForRoom(code, deviceId)
  send({ type: 'join', code, deviceId, createIfMissing: false })
  await joined
}

export function wsSubscribeRoom(code: string, onRoom: Listener): () => void {
  const set = listeners.get(code) ?? new Set<Listener>()
  set.add(onRoom)
  listeners.set(code, set)
  if (lastRoom.has(code)) onRoom(lastRoom.get(code) ?? null)
  return () => {
    set.delete(onRoom)
  }
}

export async function wsWatchRoom(code: string): Promise<void> {
  await ensureSocket()
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Timed out watching room'))
    }, 8000)
    const onError = (message: string) => {
      cleanup()
      reject(new Error(message))
    }
    errorWaiters.add(onError)
    const onState: Listener = (room) => {
      if (room) {
        cleanup()
        resolve()
      }
    }
    const set = listeners.get(code) ?? new Set<Listener>()
    set.add(onState)
    listeners.set(code, set)
    function cleanup() {
      window.clearTimeout(timeout)
      errorWaiters.delete(onError)
      set.delete(onState)
    }
  })
  send({ type: 'watch', code })
  await ready
}

export async function wsSetDeviceStatus(
  _code: string,
  _deviceId: string,
  status: DeviceState['status'],
): Promise<void> {
  send({ type: 'status', status })
}

export async function wsMoveDevice(
  _code: string,
  _deviceId: string,
  worldX: number,
  worldY: number,
): Promise<void> {
  send({ type: 'move', worldX, worldY })
}

export async function wsAttachNeighbor(dx: number, dy: number): Promise<void> {
  send({ type: 'attach', dx, dy })
}

export async function wsWriteToken(_code: string, token: TokenState): Promise<void> {
  send({ type: 'token', token })
}

export function wsCollect(key: string, cellX: number, cellY: number) {
  send({ type: 'collect', key, cellX, cellY })
}

export function wsHello(name: string) {
  send({ type: 'hello', name })
}

export function wsTradeOffer(toId: string, offer: Inventory, ask: Inventory) {
  send({ type: 'trade-offer', toId, offer, ask })
}

export function wsTradeRespond(tradeId: string, accept: boolean) {
  send({ type: 'trade-respond', tradeId, accept })
}

export async function wsAttachPresence(): Promise<void> {
  await ensureSocket()
}

export async function fetchJoinOrigin(): Promise<string> {
  try {
    const res = await fetch('/api/host-info')
    if (!res.ok) return window.location.origin
    const data = (await res.json()) as { joinOrigin?: string }
    return data.joinOrigin || window.location.origin
  } catch {
    return window.location.origin
  }
}
