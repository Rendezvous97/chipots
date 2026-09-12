import { createServer } from 'node:http'
import os from 'node:os'
import { WebSocketServer } from 'ws'
import {
  compass,
  DEFAULT_GX,
  DEFAULT_GY,
  RANGE_STALE_MS,
  SETTLE_WINDOW_MS,
  SNAP_TAIL_MS,
  calibrateGx,
  gyFromGx,
  meanRange,
  pairKey,
  pushSample,
  rangeSpan,
  smoothRange,
  snapGrid,
} from './gridSnap.mjs'
import { generateCell, RESOURCE_KINDS } from '../src/game/cellGen.mjs'

const PORT = Number(process.env.PORT ?? 8787)

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, -1],
  [0, 1],
]
const COLORS = ['#f4d35e', '#ee964b', '#f95738', '#7ae7c7', '#9b5de5', '#00bbf9', '#fee440']

/** @type {Map<string, object>} */
const rooms = new Map()
/** @type {Map<import('ws').WebSocket, { code: string, deviceId: string }>} */
const sockets = new Map()

function cellKey(x, y) {
  return `${x},${y}`
}

function occupied(devices) {
  const cells = new Set()
  for (const device of Object.values(devices ?? {})) {
    cells.add(cellKey(device.worldX, device.worldY))
  }
  return cells
}

function nextSeat(devices) {
  const all = occupied(devices)
  if (all.size === 0) return { x: 0, y: 0 }
  if (all.size === 1) return { x: 1, y: 0 }
  const sorted = [...all]
    .map((key) => {
      const [x, y] = key.split(',').map(Number)
      return { x, y }
    })
    .sort((a, b) => a.y - b.y || a.x - b.x)
  for (const cell of sorted) {
    for (const [dx, dy] of DIRS) {
      const nx = cell.x + dx
      const ny = cell.y + dy
      if (!all.has(cellKey(nx, ny))) return { x: nx, y: ny }
    }
  }
  return { x: all.size, y: 0 }
}

function emptyUwb(hostId) {
  return {
    tokens: {},
    ranges: {},
    samples: {},
    originId: hostId,
    rightId: null,
    gx: DEFAULT_GX,
    gy: DEFAULT_GY,
    unstable: false,
    calibrated: false,
    axisLocked: false,
    needSnap: false,
    movingId: null,
    carryPeak: 0,
    dirs: {},
    axisDir: {},
  }
}

function emptyInv() {
  return { sheep: 0, wheat: 0, clay: 0, stone: 0 }
}

function takenCells(room, excludeId) {
  const taken = new Set()
  for (const [id, device] of Object.entries(room.devices)) {
    if (id === excludeId) continue
    taken.add(`${device.worldX},${device.worldY}`)
  }
  return taken
}

function freeCellNear(room, id, start, carry, banned = null) {
  const taken = takenCells(room, id)
  if (banned) taken.add(`${banned.x},${banned.y}`)
  if (start && !taken.has(`${start.x},${start.y}`)) return start
  const origin = start ?? { x: room.devices[id]?.worldX ?? 0, y: room.devices[id]?.worldY ?? 0 }
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  if (carry && Math.hypot(carry.x, carry.y) > 0.02) {
    const vx = carry.x
    const vy = -carry.y
    if (Math.abs(vx) >= Math.abs(vy)) dirs.unshift([vx >= 0 ? 1 : -1, 0])
    else dirs.unshift([0, vy >= 0 ? 1 : -1])
  }
  const seen = new Set([`${origin.x},${origin.y}`])
  const queue = [origin]
  while (queue.length && seen.size < 48) {
    const cur = queue.shift()
    for (const [dx, dy] of dirs) {
      const next = { x: cur.x + dx, y: cur.y + dy }
      const key = `${next.x},${next.y}`
      if (seen.has(key)) continue
      seen.add(key)
      if (!taken.has(key)) return next
      queue.push(next)
    }
  }
  return { x: origin.x + 1, y: origin.y }
}

function packUnique(room) {
  const ids = Object.keys(room.devices).sort(
    (a, b) => (room.devices[a].joinedAt ?? 0) - (room.devices[b].joinedAt ?? 0),
  )
  for (const id of ids) {
    const device = room.devices[id]
    if (device.status === 'lifted') continue
    const next = freeCellNear(room, id, { x: device.worldX, y: device.worldY }, null)
    device.worldX = next.x
    device.worldY = next.y
  }
  rebuildExplored(room)
}

function uniqueName(room, want, deviceId) {
  const base = String(want ?? '').trim().slice(0, 18) || 'Player'
  const used = new Set(
    Object.entries(room.devices)
      .filter(([id]) => id !== deviceId)
      .map(([, device]) => String(device.name ?? '').toLowerCase()),
  )
  if (!used.has(base.toLowerCase())) return base
  let n = 2
  while (used.has(`${base} ${n}`.toLowerCase())) n += 1
  return `${base} ${n}`
}

function hasGoods(inv, bag) {
  for (const kind of RESOURCE_KINDS) {
    if ((bag[kind] ?? 0) > (inv[kind] ?? 0)) return false
  }
  return true
}

function addGoods(inv, bag, sign) {
  for (const kind of RESOURCE_KINDS) {
    const n = bag[kind] ?? 0
    if (!n) continue
    inv[kind] = Math.max(0, (inv[kind] ?? 0) + sign * n)
  }
}

function cleanGoods(raw) {
  const bag = emptyInv()
  let total = 0
  for (const kind of RESOURCE_KINDS) {
    const n = Math.max(0, Math.min(9, Math.floor(Number(raw?.[kind]) || 0)))
    bag[kind] = n
    total += n
  }
  return total > 0 ? bag : null
}

function emptyRoom(hostId) {
  return {
    hostId,
    createdAt: Date.now(),
    devices: {},
    explored: { '0,0': true },
    token: { x: 0.5, y: 0.5, vx: 0.28, vy: 0 },
    worldSeed: (Math.random() * 0xffffffff) >>> 0,
    collected: {},
    trades: {},
    winnerId: null,
    uwb: emptyUwb(hostId),
  }
}

function hasSet(inv) {
  return RESOURCE_KINDS.every((kind) => (inv?.[kind] ?? 0) >= 1)
}

function maybeWin(room) {
  if (room.winnerId) return
  for (const [id, device] of Object.entries(room.devices)) {
    if (hasSet(device.inventory)) {
      room.winnerId = id
      return
    }
  }
}

function publicRoom(room) {
  const { uwb, ...rest } = room
  const ranges = {}
  const bearings = {}
  for (const [key, d] of Object.entries(liveDistances(uwb))) {
    ranges[key.split('|').map(shortId).join('-')] = Math.round(d * 1000) / 1000
  }
  for (const [fromId, dir] of Object.entries(uwb.dirs ?? {})) {
    if (!dir || Date.now() - dir.t > RANGE_STALE_MS) continue
    const plane = Math.hypot(dir.x, dir.y)
    bearings[`${shortId(fromId)}>${shortId(dir.toId)}`] = {
      x: Math.round(dir.x * 100) / 100,
      y: Math.round(dir.y * 100) / 100,
      compass: plane >= 0.28 ? compass(dir.x, -dir.y) : '—',
    }
  }
  return {
    ...rest,
    uwb: {
      originId: uwb.originId,
      rightId: uwb.rightId,
      gx: uwb.gx,
      gy: uwb.gy,
      calibrated: Boolean(uwb.calibrated),
      needSnap: Boolean(uwb.needSnap),
      movingId: uwb.movingId ?? null,
      ranges,
      bearings,
    },
  }
}

function lanIPv4() {
  try {
    const ifaces = os.networkInterfaces()
    for (const addrs of Object.values(ifaces)) {
      for (const addr of addrs ?? []) {
        if (addr.family === 'IPv4' && !addr.internal) return addr.address
      }
    }
  } catch {
    return null
  }
  return null
}

function broadcast(code) {
  const room = rooms.get(code) ?? null
  const payload = JSON.stringify({ type: 'state', code, room: room ? publicRoom(room) : null })
  for (const [socket, meta] of sockets) {
    if (meta.code === code && socket.readyState === 1) socket.send(payload)
  }
}

function broadcastTokens(code) {
  const room = rooms.get(code)
  if (!room) return
  const payload = JSON.stringify({ type: 'ni-tokens', tokens: room.uwb.tokens })
  for (const [socket, meta] of sockets) {
    if (meta.code === code && socket.readyState === 1) socket.send(payload)
  }
}

function shortId(id) {
  return String(id).slice(0, 4)
}

function logSnap(room, why) {
  const cells = Object.entries(room.devices)
    .map(([id, d]) => `${shortId(id)}@${d.worldX},${d.worldY}/${d.status}`)
    .join(' ')
  const ranges = Object.entries(liveDistances(room.uwb))
    .map(([k, d]) => `${k.split('|').map(shortId).join('-')}:${d.toFixed(2)}`)
    .join(' ')
  const bearings = Object.entries(room.uwb.dirs ?? {})
    .map(([id, dir]) => `${shortId(id)}>${shortId(dir.toId)}:${compass(dir.x, -dir.y)}`)
    .join(' ')
  console.log(
    `[uwb ${why}] n=${Object.keys(room.devices).length} tokens=${Object.keys(room.uwb.tokens).length} origin=${shortId(room.uwb.originId)} right=${shortId(room.uwb.rightId ?? '')} gx=${room.uwb.gx.toFixed(3)} gy=${room.uwb.gy.toFixed(3)} ranges ${ranges || 'none'} dir ${bearings || 'none'} | ${cells}`,
  )
}

function liveDistances(uwb) {
  const now = Date.now()
  /** @type {Record<string, number>} */
  const out = {}
  for (const [key, entry] of Object.entries(uwb.ranges)) {
    if (!entry || now - entry.t > RANGE_STALE_MS) continue
    out[key] = entry.d
  }
  return out
}

function rebuildExplored(room) {
  const next = {}
  for (const device of Object.values(room.devices)) {
    next[cellKey(device.worldX, device.worldY)] = true
  }
  room.explored = next
}

function anyoneLifted(room) {
  return Object.values(room.devices).some((device) => device.status === 'lifted')
}

function clearPairSamples(uwb, deviceId) {
  for (const key of Object.keys(uwb.samples ?? {})) {
    if (key.split('|').includes(deviceId)) uwb.samples[key] = []
  }
}

function tablePhoneIds(room) {
  const uwb = room.uwb ?? emptyUwb('')
  const ranged = new Set()
  for (const key of Object.keys(liveDistances(uwb))) {
    for (const id of key.split('|')) ranged.add(id)
  }
  return Object.keys(room.devices)
    .filter((id) => uwb.tokens[id] || ranged.has(id))
    .sort((a, b) => (room.devices[a].joinedAt ?? 0) - (room.devices[b].joinedAt ?? 0))
}

function ensureAxis(room) {
  const uwb = room.uwb
  if (!uwb) return
  const ids = tablePhoneIds(room)
  if (ids.length < 2) return false
  if (!ids.includes(uwb.originId)) uwb.originId = ids[0]
  if (!ids.includes(uwb.rightId) || uwb.rightId === uwb.originId) {
    uwb.rightId = ids.find((id) => id !== uwb.originId) ?? null
  }
  const originId = uwb.originId
  const rightId = uwb.rightId
  if (!originId || !rightId) return false
  const d = liveDistances(uwb)[pairKey(originId, rightId)]
  const gx = calibrateGx(d)
  if (gx && !uwb.calibrated) {
    uwb.gx = gx
    uwb.gy = gyFromGx(gx)
    uwb.calibrated = true
  }
  if (!uwb.axisLocked && uwb.calibrated && room.devices[originId] && room.devices[rightId]) {
    room.devices[originId].worldX = 0
    room.devices[originId].worldY = 0
    room.devices[rightId].worldX = 1
    room.devices[rightId].worldY = 0
    uwb.axisLocked = true
    packUnique(room)
    logSnap(room, 'axis-auto')
  }
  return true
}

function applySnap(room, movingId = null) {
  ensureAxis(room)
  const uwb = room.uwb
  if (!uwb.originId || !uwb.rightId) return false
  const ranged = new Set()
  for (const key of Object.keys(liveDistances(uwb))) {
    for (const id of key.split('|')) ranged.add(id)
  }
  const deviceIds = Object.keys(room.devices).filter(
    (id) => uwb.tokens[id] || ranged.has(id),
  )
  if (deviceIds.length < 2) return false
  if (!uwb.originId || !deviceIds.includes(uwb.originId)) {
    uwb.originId = deviceIds[0]
  }

  const previous = {}
  for (const id of deviceIds) {
    const device = room.devices[id]
    previous[id] = { x: device.worldX, y: device.worldY }
  }

  const { positions } = snapGrid({
    deviceIds,
    distances: liveDistances(uwb),
    originId: uwb.originId,
    rightId: uwb.rightId && deviceIds.includes(uwb.rightId) ? uwb.rightId : null,
    gx: uwb.gx,
    gy: uwb.gy,
    previous,
    movingId,
    leftHome: (uwb.carryPeak ?? 0) > Math.max(uwb.gx, 0.08) * 1.4,
    dirs: uwb.dirs ?? {},
    axisDir: uwb.axisDir ?? {},
    carry: uwb.carry ?? null,
  })

  const idsToWrite = movingId ? [movingId] : Object.keys(positions)
  const moved =
    Boolean(inputMoved(uwb)) && Boolean(movingId)
  let changed = false
  for (const id of idsToWrite) {
    const pos = positions[id]
    const device = room.devices[id]
    if (!pos || !device) continue
    if (device.status === 'lifted') continue
    let next = { x: pos.x, y: pos.y }
    const prev = previous[id]
    if (
      moved &&
      id === movingId &&
      prev &&
      next.x === prev.x &&
      next.y === prev.y
    ) {
      next = freeCellNear(room, id, null, uwb.carry, prev)
    }
    next = freeCellNear(room, id, next, id === movingId ? uwb.carry : null)
    if (device.worldX !== next.x || device.worldY !== next.y) changed = true
    device.worldX = next.x
    device.worldY = next.y
    if (device.status !== 'table') {
      device.status = 'table'
      changed = true
    }
  }
  const beforePack = {}
  for (const [id, d] of Object.entries(room.devices)) {
    beforePack[id] = `${d.worldX},${d.worldY}`
  }
  packUnique(room)
  for (const [id, d] of Object.entries(room.devices)) {
    if (beforePack[id] !== `${d.worldX},${d.worldY}`) changed = true
  }
  return changed
}

function inputMoved(uwb) {
  if ((uwb.carryPeak ?? 0) > Math.max(uwb.gx, 0.08) * 1.05) return true
  if (uwb.carry && Math.hypot(uwb.carry.x, uwb.carry.y) > 0.018) return true
  return false
}

function joinDevice(code, deviceId, createIfMissing, native = false, name = '') {
  let room = rooms.get(code)
  if (!room) {
    if (!createIfMissing) return { error: 'Room not found' }
    room = emptyRoom(deviceId)
    rooms.set(code, room)
  }
  if (!room.uwb) room.uwb = emptyUwb(room.hostId)
  if (room.devices[deviceId]) {
    const trimmed = String(name ?? '').trim()
    if (trimmed) room.devices[deviceId].name = uniqueName(room, trimmed, deviceId)
    return { room }
  }
  if (!native) {
    return { room }
  }
  if (room.worldSeed == null) room.worldSeed = (Math.random() * 0xffffffff) >>> 0
  if (!room.collected) room.collected = {}
  const seat = nextSeat(room.devices)
  const index = Object.keys(room.devices).length
  const trimmed = String(name ?? '').trim()
  room.devices[deviceId] = {
    worldX: seat.x,
    worldY: seat.y,
    status: 'table',
    joinedAt: Date.now(),
    color: COLORS[index % COLORS.length],
    inventory: emptyInv(),
  }
  if (trimmed) room.devices[deviceId].name = uniqueName(room, trimmed, deviceId)
  packUnique(room)
  if (!room.uwb.originId) room.uwb.originId = deviceId
  ensureAxis(room)
  return { room }
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.url === '/api/host-info' || req.url === '/host-info') {
    const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`)
    const port = hostHeader.includes(':') ? hostHeader.split(':')[1] : '5173'
    const protoHeader = String(req.headers['x-forwarded-proto'] || 'http')
    const lan = lanIPv4()
    const httpsOrigin = process.env.PUBLIC_JOIN_ORIGIN || null
    const joinOrigin =
      (lan ? `http://${lan}:${port}` : null) ||
      httpsOrigin ||
      `${protoHeader}://${hostHeader}`
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ joinOrigin, lan, host: hostHeader }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('tabletop sync')
})

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }

    if (msg.type === 'watch') {
      const code = String(msg.code ?? '').toUpperCase()
      let room = rooms.get(code)
      if (!room && msg.createIfMissing) {
        room = emptyRoom('')
        rooms.set(code, room)
      }
      if (!room) {
        socket.send(JSON.stringify({ type: 'error', message: 'Room not found' }))
        return
      }
      sockets.set(socket, { code, deviceId: '', watch: true })
      console.log(`[watch] ${code} devices=${Object.keys(room.devices).length}`)
      socket.send(JSON.stringify({ type: 'state', code, room: publicRoom(room) }))
      return
    }

    if (msg.type === 'join') {
      const code = String(msg.code ?? '').toUpperCase()
      const deviceId = String(msg.deviceId ?? '')
      const result = joinDevice(
        code,
        deviceId,
        Boolean(msg.createIfMissing),
        Boolean(msg.native),
        String(msg.name ?? ''),
      )
      if (result.error) {
        socket.send(JSON.stringify({ type: 'error', message: result.error }))
        return
      }
      sockets.set(socket, { code, deviceId })
      console.log(
        `[join] ${code} ${shortId(deviceId)} devices=${Object.keys(result.room.devices).length} ${Object.keys(result.room.devices).map(shortId).join(',')}`,
      )
      broadcast(code)
      broadcastTokens(code)
      return
    }

    const meta = sockets.get(socket)
    if (!meta) return
    const room = rooms.get(meta.code)
    if (!room) return
    if (!room.uwb) room.uwb = emptyUwb(room.hostId)

    const device = room.devices[meta.deviceId]
    if (!device) return

    if (msg.type === 'status') {
      const next = msg.status === 'lifted' ? 'lifted' : 'table'
      const cx = Number(msg.carryX)
      const cy = Number(msg.carryY)
      const carry =
        Number.isFinite(cx) && Number.isFinite(cy) && Math.hypot(cx, cy) > 0.015
          ? { x: cx, y: cy }
          : null
      if (device.status === next && !(next === 'table' && carry)) return
      device.status = next
      if (next === 'lifted') {
        room.uwb.needSnap = false
        room.uwb.movingId = meta.deviceId
        room.uwb.unstable = true
        room.uwb.carryPeak = 0
        room.uwb.carry = null
        for (const [key, d] of Object.entries(liveDistances(room.uwb))) {
          if (key.split('|').includes(meta.deviceId)) {
            room.uwb.carryPeak = Math.max(room.uwb.carryPeak, d)
          }
        }
        clearPairSamples(room.uwb, meta.deviceId)
        logSnap(room, 'lift')
        broadcast(meta.code)
      } else {
        room.uwb.carry = carry
        clearPairSamples(room.uwb, meta.deviceId)
        room.uwb.needSnap = true
        room.uwb.movingId = meta.deviceId
        room.uwb.didSnap = false
        let changed = applySnap(room, meta.deviceId)
        if (!changed && (carry || inputMoved(room.uwb))) {
          const prev = { x: device.worldX, y: device.worldY }
          const next = freeCellNear(room, meta.deviceId, null, carry, prev)
          if (next.x !== prev.x || next.y !== prev.y) {
            device.worldX = next.x
            device.worldY = next.y
            changed = true
            rebuildExplored(room)
          }
        }
        room.uwb.needSnap = !changed
        logSnap(room, changed ? 'place-snap' : 'place')
        broadcast(meta.code)
      }
    } else if (msg.type === 'nudge') {
      const dx = Number(msg.dx) || 0
      const dy = Number(msg.dy) || 0
      if (Math.abs(dx) + Math.abs(dy) !== 1) return
      const otherId = Object.keys(room.devices).find((id) => id !== meta.deviceId)
      if (!otherId) return
      const other = room.devices[otherId]
      const nx = other.worldX + dx
      const ny = other.worldY + dy
      if (other.worldX === nx && other.worldY === ny) return
      device.worldX = nx
      device.worldY = ny
      device.status = 'table'
      room.uwb.needSnap = false
      room.uwb.movingId = meta.deviceId
      rebuildExplored(room)
      logSnap(room, 'nudge')
      broadcast(meta.code)
    } else if (msg.type === 'move') {
      device.worldX = msg.worldX
      device.worldY = msg.worldY
      device.status = 'table'
      room.explored = { ...room.explored, [cellKey(msg.worldX, msg.worldY)]: true }
      broadcast(meta.code)
    } else if (msg.type === 'attach') {
      const liftedId = Object.keys(room.devices).find(
        (id) => room.devices[id].status === 'lifted',
      )
      if (!liftedId) return
      const dx = Number(msg.dx) || 0
      const dy = Number(msg.dy) || 0
      if (Math.abs(dx) + Math.abs(dy) !== 1) return
      const nx = device.worldX + dx
      const ny = device.worldY + dy
      const blocked = Object.entries(room.devices).some(
        ([id, other]) =>
          id !== liftedId &&
          other.status === 'table' &&
          other.worldX === nx &&
          other.worldY === ny,
      )
      if (blocked) return
      room.devices[liftedId].worldX = nx
      room.devices[liftedId].worldY = ny
      room.devices[liftedId].status = 'table'
      room.explored = { ...room.explored, [cellKey(nx, ny)]: true }
      broadcast(meta.code)
    } else if (msg.type === 'token') {
      room.token = msg.token
      broadcast(meta.code)
    } else if (msg.type === 'collect') {
      if (device.status !== 'table') return
      if (room.worldSeed == null) room.worldSeed = 1
      if (!room.collected) room.collected = {}
      const key = String(msg.key ?? '')
      const parts = key.split(':')
      if (parts.length !== 3) return
      const [cell, kind] = parts
      if (!RESOURCE_KINDS.includes(kind)) return
      if (!/^-?\d+,-?\d+$/.test(cell)) return
      const [cx, cy] = cell.split(',').map(Number)
      if (device.worldX !== cx || device.worldY !== cy) return
      if (room.collected[key]) return
      const view = generateCell(cx, cy, room.worldSeed)
      if (!view.resources.some((item) => item.key === key)) return
      room.collected[key] = meta.deviceId
      if (!device.inventory) {
        device.inventory = { sheep: 0, wheat: 0, clay: 0, stone: 0 }
      }
      device.inventory[kind] = (device.inventory[kind] ?? 0) + 1
      maybeWin(room)
      broadcast(meta.code)
    } else if (msg.type === 'hello') {
      const name = uniqueName(room, msg.name, meta.deviceId)
      device.name = name
      broadcast(meta.code)
    } else if (msg.type === 'trade-offer') {
      if (!room.trades) room.trades = {}
      const toId = String(msg.toId ?? '')
      if (!room.devices[toId] || toId === meta.deviceId) return
      const offer = cleanGoods(msg.offer)
      const ask = cleanGoods(msg.ask)
      if (!offer || !ask) return
      if (!device.inventory) device.inventory = emptyInv()
      if (!hasGoods(device.inventory, offer)) return
      const id = `t${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`
      room.trades[id] = {
        id,
        from: meta.deviceId,
        to: toId,
        offer,
        ask,
        status: 'pending',
      }
      broadcast(meta.code)
    } else if (msg.type === 'trade-respond') {
      if (!room.trades) room.trades = {}
      const trade = room.trades[String(msg.tradeId ?? '')]
      if (!trade || trade.to !== meta.deviceId || trade.status !== 'pending') return
      if (!msg.accept) {
        trade.status = 'declined'
        broadcast(meta.code)
        return
      }
      const from = room.devices[trade.from]
      const to = room.devices[trade.to]
      if (!from || !to) return
      from.inventory = from.inventory ?? emptyInv()
      to.inventory = to.inventory ?? emptyInv()
      if (!hasGoods(from.inventory, trade.offer) || !hasGoods(to.inventory, trade.ask)) {
        trade.status = 'failed'
      } else {
        addGoods(from.inventory, trade.offer, -1)
        addGoods(to.inventory, trade.offer, 1)
        addGoods(to.inventory, trade.ask, -1)
        addGoods(from.inventory, trade.ask, 1)
        trade.status = 'done'
        maybeWin(room)
      }
      broadcast(meta.code)
    } else if (msg.type === 'ni-token') {
      const token = String(msg.token ?? '')
      if (!token) return
      if (room.uwb.tokens[meta.deviceId] === token) return
      room.uwb.tokens[meta.deviceId] = token
      console.log(`[ni-token] ${shortId(meta.deviceId)} count=${Object.keys(room.uwb.tokens).length}`)
      ensureAxis(room)
      broadcastTokens(meta.code)
      if (room.uwb.axisLocked) broadcast(meta.code)
    } else if (msg.type === 'uwb-range') {
      const toId = String(msg.toId ?? '')
      const distance = Number(msg.distance)
      if (!toId || toId === meta.deviceId || !Number.isFinite(distance) || distance <= 0) return
      const key = pairKey(meta.deviceId, toId)
      const prev = room.uwb.ranges[key]?.d
      room.uwb.ranges[key] = { d: smoothRange(prev, distance), t: Date.now() }
      const dx = Number(msg.dx)
      const dy = Number(msg.dy)
      const dz = Number(msg.dz)
      if (Number.isFinite(dx) && Number.isFinite(dy)) {
        if (!room.uwb.dirs) room.uwb.dirs = {}
        room.uwb.dirs[meta.deviceId] = { toId, x: dx, y: dy, z: Number.isFinite(dz) ? dz : 0, t: Date.now() }
        if (!room.uwb.axisDir) room.uwb.axisDir = {}
        if (
          room.uwb.originId &&
          room.uwb.rightId &&
          !room.uwb.axisDir[meta.deviceId] &&
          Math.hypot(dx, dy) >= 0.28
        ) {
          const lookingAtRight =
            meta.deviceId === room.uwb.originId && toId === room.uwb.rightId
          const lookingAtOrigin =
            meta.deviceId === room.uwb.rightId && toId === room.uwb.originId
          if (lookingAtRight || lookingAtOrigin) {
            room.uwb.axisDir[meta.deviceId] = { x: dx, y: dy }
          }
        }
      }
      if (!room.uwb.samples) room.uwb.samples = {}
      pushSample(room.uwb.samples, key, room.uwb.ranges[key].d)
      if (anyoneLifted(room)) {
        room.uwb.carryPeak = Math.max(room.uwb.carryPeak ?? 0, room.uwb.ranges[key].d)
      }
      const now = Date.now()
      if (now - (room.uwb.lastPub ?? 0) > 250) {
        room.uwb.lastPub = now
        broadcast(meta.code)
      }
      ensureAxis(room)
      if (!room.uwb.originId || !room.uwb.rightId) return
      if (anyoneLifted(room)) return
      if (!room.uwb.needSnap) return
      const recent = (room.uwb.samples[key] ?? []).filter((sample) => now - sample.t <= SETTLE_WINDOW_MS)
      if (recent.length < 5) return
      if (rangeSpan(room.uwb.samples[key], now) > 0.22) return
      const avg = meanRange(room.uwb.samples[key], Date.now(), SNAP_TAIL_MS)
      if (avg != null) room.uwb.ranges[key] = { d: avg, t: Date.now() }
      const d = avg ?? room.uwb.ranges[key].d
      const neighborMax = Math.max(room.uwb.gx, room.uwb.gy) * 2.2 + 0.05
      if (d > neighborMax) return
      const movingId = room.uwb.movingId
      const dists = liveDistances(room.uwb)
      if (movingId && !Object.keys(dists).some((k) => k.split('|').includes(movingId))) return
      const changed = applySnap(room, movingId)
      room.uwb.unstable = false
      room.uwb.needSnap = false
      room.uwb.didSnap = true
      logSnap(room, changed ? 'snap' : 'settle')
      room.uwb.lastPub = Date.now()
      broadcast(meta.code)
    } else if (msg.type === 'uwb-axis') {
      const originId = String(msg.originId ?? meta.deviceId)
      const rightId = String(msg.rightId ?? '')
      if (!room.devices[originId]) return
      room.uwb.originId = originId
      room.uwb.rightId = room.devices[rightId] ? rightId : null
      room.devices[originId].worldX = 0
      room.devices[originId].worldY = 0
      if (room.uwb.rightId) {
        room.devices[room.uwb.rightId].worldX = 1
        room.devices[room.uwb.rightId].worldY = 0
        room.devices[room.uwb.rightId].status = 'table'
        const d = liveDistances(room.uwb)[pairKey(originId, room.uwb.rightId)]
        const gx = calibrateGx(d)
        if (gx) {
          room.uwb.gx = gx
          room.uwb.gy = gyFromGx(gx)
        }
        room.uwb.calibrated = true
        room.uwb.axisLocked = true
      }
      rebuildExplored(room)
      room.uwb.didSnap = true
      room.uwb.needSnap = false
      room.uwb.unstable = false
      logSnap(room, 'axis')
      broadcast(meta.code)
    } else if (msg.type === 'uwb-calibrate') {
      const kind = String(msg.kind ?? 'gx')
      const ids = Object.keys(room.devices)
      if (!room.uwb.originId || !room.devices[room.uwb.originId]) {
        room.uwb.originId = meta.deviceId
      }
      if (!room.uwb.rightId && ids.length === 2) {
        room.uwb.rightId = ids.find((id) => id !== room.uwb.originId) ?? null
      }
      const originId = room.uwb.originId
      const rightId = room.uwb.rightId
      if (kind === 'gx' && originId && rightId) {
        const d = liveDistances(room.uwb)[pairKey(originId, rightId)]
        const gx = calibrateGx(d)
        if (gx) {
          room.uwb.gx = gx
          room.uwb.gy = gyFromGx(gx)
          room.uwb.calibrated = true
        }
      } else if (kind === 'gy' && Number.isFinite(Number(msg.value))) {
        const gy = Number(msg.value)
        if (gy > 0.06 && gy < 0.35) room.uwb.gy = gy
      }
      if (originId && rightId && room.devices[originId] && room.devices[rightId]) {
        room.devices[originId].worldX = 0
        room.devices[originId].worldY = 0
        room.devices[rightId].worldX = 1
        room.devices[rightId].worldY = 0
      }
      rebuildExplored(room)
      room.uwb.didSnap = true
      room.uwb.needSnap = false
      room.uwb.unstable = false
      logSnap(room, 'calibrate')
      broadcast(meta.code)
    }
  })

  socket.on('close', () => {
    const meta = sockets.get(socket)
    sockets.delete(socket)
    if (!meta) return
    if (meta.watch || !meta.deviceId) return
    const stillHere = [...sockets.values()].some(
      (other) => other.code === meta.code && other.deviceId === meta.deviceId,
    )
    if (stillHere) return
    const room = rooms.get(meta.code)
    if (!room?.devices[meta.deviceId]) return
    delete room.devices[meta.deviceId]
    if (room.uwb) {
      delete room.uwb.tokens[meta.deviceId]
      for (const key of Object.keys(room.uwb.ranges)) {
        if (key.split('|').includes(meta.deviceId)) delete room.uwb.ranges[key]
      }
      if (room.uwb.originId === meta.deviceId) {
        room.uwb.originId = Object.keys(room.devices)[0] ?? null
      }
      if (room.uwb.rightId === meta.deviceId) room.uwb.rightId = null
    }
    if (Object.keys(room.devices).length === 0) rooms.delete(meta.code)
    else {
      broadcast(meta.code)
      broadcastTokens(meta.code)
    }
  })
})

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanIPv4()
  console.log(`sync server http://localhost:${PORT}`)
  if (lan) console.log(`phones can use http://${lan}:5173  (same Wi‑Fi as this laptop)`)
})
