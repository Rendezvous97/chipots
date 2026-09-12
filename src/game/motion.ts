import type { Cell, DeviceState } from '../types'
import { validSlots } from './world'

export type MotionPhase = 'table' | 'carried' | 'placing'

const LIFT_TILT = 0.22
const PLACE_TILT = 0.2
const LIFT_MS = 160
const PLACE_MS = 200
const MIN_CARRY_MS = 180
const IMPULSE_MIN = 0.28

type PermissionCtor = {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

function ctorPermission(name: 'DeviceMotionEvent' | 'DeviceOrientationEvent'): PermissionCtor | undefined {
  const value = (window as unknown as Record<string, PermissionCtor | undefined>)[name]
  return value
}

export function sensorsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    (Boolean(ctorPermission('DeviceMotionEvent')) ||
      Boolean(ctorPermission('DeviceOrientationEvent')))
  )
}

export async function requestMotionPermission(): Promise<boolean> {
  const requestOne = async (ctor?: PermissionCtor) => {
    if (!ctor || typeof ctor.requestPermission !== 'function') return null
    const result = await ctor.requestPermission()
    return result === 'granted'
  }

  try {
    const orientation = await requestOne(ctorPermission('DeviceOrientationEvent'))
    const motion = await requestOne(ctorPermission('DeviceMotionEvent'))
    if (orientation === false && motion !== true) return false
    if (motion === false && orientation !== true) return false
    return true
  } catch {
    return sensorsSupported()
  }
}

function tiltFromGravity(gx: number, gy: number, gz: number): number {
  const mag = Math.hypot(gx, gy, gz) || 1
  return Math.hypot(gx, gy) / mag
}

function tiltFromOrientation(beta: number | null, gamma: number | null): number {
  return Math.min(1.2, Math.hypot((beta ?? 0) / 90, (gamma ?? 0) / 90))
}

function projectTable(
  ax: number,
  ay: number,
  az: number,
  gx: number,
  gy: number,
  gz: number,
): { east: number; north: number } {
  const gmag = Math.hypot(gx, gy, gz) || 1
  const ghx = gx / gmag
  const ghy = gy / gmag
  const ghz = gz / gmag
  const rx = 1 - ghx * ghx
  const ry = 0 - ghx * ghy
  const rz = 0 - ghx * ghz
  const rmag = Math.hypot(rx, ry, rz) || 1
  const fx = 0 - ghy * ghx
  const fy = 1 - ghy * ghy
  const fz = 0 - ghy * ghz
  const fmag = Math.hypot(fx, fy, fz) || 1
  return {
    east: (ax * rx + ay * ry + az * rz) / rmag,
    north: (ax * fx + ay * fy + az * fz) / fmag,
  }
}

function considerPeak(
  east: number,
  north: number,
  peak: { mag: number; east: number; north: number },
) {
  const mag = Math.hypot(east, north)
  if (mag > peak.mag) {
    peak.mag = mag
    peak.east = east
    peak.north = north
  }
}

export function createMotionTracker() {
  let phase: MotionPhase = 'table'
  let liftStarted = 0
  let placeStarted = 0
  let carryStarted = 0
  const peak = { mag: 0, east: 0, north: 0 }
  let lastT = 0
  let slowX = 0
  let slowY = 0
  let slowZ = 0
  let primed = false
  let beta0 = 0
  let gamma0 = 0

  function ingestTilt(tilt: number, now: number) {
    lastT = now
    if (phase === 'table') {
      if (tilt > LIFT_TILT) {
        if (!liftStarted) liftStarted = now
        if (now - liftStarted >= LIFT_MS) {
          phase = 'carried'
          carryStarted = now
          peak.mag = 0
          peak.east = 0
          peak.north = 0
          liftStarted = 0
        }
      } else {
        liftStarted = 0
      }
    } else if (phase === 'carried') {
      if (tilt < PLACE_TILT) {
        if (!placeStarted) placeStarted = now
        if (now - placeStarted >= PLACE_MS) phase = 'placing'
      } else {
        placeStarted = 0
      }
    }
  }

  function onMotion(event: DeviceMotionEvent, now = performance.now()) {
    const g = event.accelerationIncludingGravity
    const lin = event.acceleration
    const gx = g?.x ?? 0
    const gy = g?.y ?? 0
    const gz = g?.z ?? 9.8
    if (g) {
      if (!primed) {
        slowX = gx
        slowY = gy
        slowZ = gz
        primed = true
      }
      slowX = slowX * 0.9 + gx * 0.1
      slowY = slowY * 0.9 + gy * 0.1
      slowZ = slowZ * 0.9 + gz * 0.1
    }

    const tilt = g ? tiltFromGravity(gx, gy, gz) : 0
    ingestTilt(tilt, now)
    if (phase !== 'carried') return

    let ax = lin?.x ?? 0
    let ay = lin?.y ?? 0
    let az = lin?.z ?? 0
    if (!lin || Math.hypot(ax, ay, az) < 0.08) {
      ax = gx - slowX
      ay = gy - slowY
      az = gz - slowZ
    }
    const table = projectTable(ax, ay, az, slowX, slowY, slowZ)
    considerPeak(table.east, table.north, peak)
  }

  function onOrientation(event: DeviceOrientationEvent, now = performance.now()) {
    const beta = event.beta ?? 0
    const gamma = event.gamma ?? 0
    ingestTilt(tiltFromOrientation(event.beta, event.gamma), now)
    if (phase === 'table') {
      beta0 = beta
      gamma0 = gamma
      return
    }
    if (phase !== 'carried') return
    considerPeak((gamma - gamma0) / 18, -(beta - beta0) / 18, peak)
  }

  function consumePlacement(): { motionX: number; motionY: number } | null {
    if (phase !== 'placing') return null
    const carryMs = lastT - carryStarted
    const stayed = peak.mag < IMPULSE_MIN || carryMs < MIN_CARRY_MS
    const result = stayed
      ? { motionX: 0, motionY: 0 }
      : { motionX: peak.east, motionY: peak.north }
    phase = 'table'
    placeStarted = 0
    liftStarted = 0
    peak.mag = 0
    peak.east = 0
    peak.north = 0
    return result
  }

  function getPhase() {
    return phase
  }

  function getPeak() {
    return peak.mag
  }

  return { onMotion, onOrientation, consumePlacement, getPhase, getPeak }
}

export function chooseSlot(
  devices: Record<string, DeviceState>,
  movingId: string,
  origin: Cell,
  motionX: number,
  motionY: number,
): Cell {
  const slots = validSlots(devices, movingId)
  const stay = slots.find((s) => s.x === origin.x && s.y === origin.y) ?? origin
  const east = motionX
  const south = -motionY
  const mag = Math.hypot(east, south)
  if (mag < 0.0001) return stay
  const ux = east / mag
  const uy = south / mag

  let best = stay
  let bestDot = 0.12
  for (const slot of slots) {
    const vx = slot.x - origin.x
    const vy = slot.y - origin.y
    const smag = Math.hypot(vx, vy)
    if (smag < 0.5) continue
    const dot = (vx / smag) * ux + (vy / smag) * uy
    if (dot > bestDot) {
      bestDot = dot
      best = slot
    }
  }
  return best
}
