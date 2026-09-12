/**
 * Integer table layout from UWB distances.
 *
 * Positions only change on a settled measurement, and only onto a
 * 4-connected polyomino. Jitter and in-air motion must not flip cells.
 */

export const DEFAULT_GX = 0.085
export const DEFAULT_GY = 0.16
/** iPhone portrait height/width. Gy is not the uncalibrated 0.16 default. */
export const PHONE_ASPECT = 2.1
export const RANGE_STALE_MS = 2500
export const FAR_MULTIPLIER = 2.4
export const CLEAR_M = 0.08
export const MOTION_SPAN_M = 0.1
export const SETTLE_WINDOW_MS = 800
export const SNAP_TAIL_MS = 280

export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function smoothRange(prev, measured, alpha = 0.45) {
  if (prev == null || !Number.isFinite(prev)) return measured
  return prev * (1 - alpha) + measured * alpha
}

export function pushSample(buffer, key, distance, now = Date.now()) {
  const list = buffer[key] ?? []
  list.push({ t: now, d: distance })
  buffer[key] = list.filter((sample) => now - sample.t < 2000)
}

export function rangeSpan(samples, now = Date.now(), windowMs = SETTLE_WINDOW_MS) {
  const recent = (samples ?? []).filter((sample) => now - sample.t <= windowMs)
  if (recent.length < 4) return 0
  const values = recent.map((sample) => sample.d)
  return Math.max(...values) - Math.min(...values)
}

export function meanRange(samples, now = Date.now(), windowMs = SETTLE_WINDOW_MS) {
  const recent = (samples ?? []).filter((sample) => now - sample.t <= windowMs)
  if (recent.length === 0) return null
  return recent.reduce((sum, sample) => sum + sample.d, 0) / recent.length
}

export function rangeMotion(samples, now = Date.now()) {
  const recent = (samples ?? []).filter((sample) => now - sample.t <= SETTLE_WINDOW_MS)
  if (recent.length < 6) return 'warm'
  return rangeSpan(samples, now) > MOTION_SPAN_M ? 'move' : 'still'
}

export function isSettled(samples, now = Date.now()) {
  return rangeMotion(samples, now) === 'still'
}

function hypotCell(dx, dy, gx, gy) {
  return Math.hypot(dx * gx, dy * gy)
}

function occupiedSet(positions) {
  return new Set(Object.values(positions).map((p) => `${p.x},${p.y}`))
}

export const DIR_FLAT_MIN = 0.28

export function compass(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W'
  return dy >= 0 ? 'S' : 'N'
}

/**
 * Map a phone-frame NI direction onto the table grid using the vector we
 * recorded when the user said “this other phone is on my right.”
 * Phone +X is right, +Y is toward the top of the device.
 */
export function gridVecFromPhone(dir, referencePhone, referenceGrid) {
  if (!dir) return null
  const plane = Math.hypot(dir.x, dir.y)
  if (plane < DIR_FLAT_MIN) return null
  const local = { x: dir.x, y: -dir.y }
  if (!referencePhone || !referenceGrid) return local
  const refPlane = Math.hypot(referencePhone.x, referencePhone.y)
  if (refPlane < DIR_FLAT_MIN) return local
  const refLocal = { x: referencePhone.x, y: -referencePhone.y }
  const refAng = Math.atan2(refLocal.y, refLocal.x)
  const wantAng = Math.atan2(referenceGrid.y, referenceGrid.x)
  const curAng = Math.atan2(local.y, local.x)
  const gridAng = curAng + (wantAng - refAng)
  return { x: Math.cos(gridAng), y: Math.sin(gridAng) }
}

export function neighborFromGridVec(anchor, vec) {
  if (!anchor || !vec) return null
  if (Math.abs(vec.x) >= Math.abs(vec.y)) {
    return { x: anchor.x + (vec.x >= 0 ? 1 : -1), y: anchor.y }
  }
  return { x: anchor.x, y: anchor.y + (vec.y >= 0 ? 1 : -1) }
}

/**
 * Only trust Gx vs Gy when one is clearly closer. Real stacked vs side-by-side
 * ranges often overlap by a few cm, so carry has to win that band.
 */
export function rangeAxis(d, gx, gy) {
  if (d == null) return null
  const eH = Math.abs(d - gx)
  const eV = Math.abs(d - gy)
  const clear = Math.max(0.05, (gy - gx) * 0.45)
  if (eV < eH && eH - eV > clear) return 'V'
  if (eH < eV && eV - eH > clear) return 'H'
  return null
}

/**
 * IMU carry is the main seat when you actually moved the phone. Range only
 * vetoes that guess when distance is unambiguously the other axis.
 */
export function cellFromCarry(anchor, carry, taken, d, gx, gy) {
  if (!anchor || !carry || Math.hypot(carry.x, carry.y) < 0.018) return null
  let vec = { x: carry.x, y: -carry.y }
  const axis = rangeAxis(d, gx, gy)
  if (axis === 'H') vec = { x: Math.abs(vec.x) >= 0.02 ? vec.x : 1, y: 0 }
  else if (axis === 'V') vec = { x: 0, y: Math.abs(vec.y) >= 0.02 ? vec.y : 1 }
  const cell = neighborFromGridVec(anchor, vec)
  if (!cell || taken?.has(`${cell.x},${cell.y}`)) return null
  return cell
}

/**
 * Put one phone on the best 4-neighbor of the phones still on the table.
 * Keeps the last cell unless another neighbor is clearly closer to the ranges.
 */
export function bestCellFor(id, anchors, distances, gx, gy, previousCell, opts = {}) {
  const taken = occupiedSet(anchors)
  const options = adjacentEmpty(anchors)
  if (
    previousCell &&
    !taken.has(`${previousCell.x},${previousCell.y}`) &&
    !options.some((cell) => cell.x === previousCell.x && cell.y === previousCell.y)
  ) {
    options.push({ x: previousCell.x, y: previousCell.y })
  }
  if (options.length === 0) return previousCell ?? { x: 1, y: 0 }

  const leftHome = Boolean(opts.leftHome)
  let best = previousCell ?? options[0]
  let bestErr = Infinity
  for (const cell of options) {
    let error = 0
    let pairs = 0
    for (const [anchorId, pos] of Object.entries(anchors)) {
      const d = distances[pairKey(id, anchorId)]
      if (d == null) continue
      const expected = hypotCell(cell.x - pos.x, cell.y - pos.y, gx, gy)
      const delta = d - expected
      error += delta * delta
      pairs += 1
    }
    if (pairs === 0) continue
    const rms = Math.sqrt(error / pairs)
    const same =
      previousCell && cell.x === previousCell.x && cell.y === previousCell.y
    // Distance to the left vs right of an anchor is identical. After a real
    // carry, do not glue the phone back onto the cell it left.
    const stayBonus = same && !leftHome ? CLEAR_M : 0
    const leavePenalty = same && leftHome ? CLEAR_M : 0
    const score = rms - stayBonus + leavePenalty
    if (score < bestErr) {
      bestErr = score
      best = { x: cell.x, y: cell.y }
    }
  }
  return best
}

function scorePlacement(ids, positions, distances, gx, gy) {
  let error = 0
  let pairs = 0
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]
      const b = ids[j]
      const d = distances[pairKey(a, b)]
      if (d == null) continue
      const pa = positions[a]
      const pb = positions[b]
      if (!pa || !pb) continue
      const expected = hypotCell(pa.x - pb.x, pa.y - pb.y, gx, gy)
      const delta = d - expected
      error += delta * delta
      pairs += 1
    }
  }
  return { error, pairs }
}

function adjacentEmpty(positions) {
  const taken = new Set(Object.values(positions).map((p) => `${p.x},${p.y}`))
  const cells = []
  const seen = new Set()
  for (const { x, y } of Object.values(positions)) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx
      const ny = y + dy
      const key = `${nx},${ny}`
      if (taken.has(key) || seen.has(key)) continue
      seen.add(key)
      cells.push({ x: nx, y: ny })
    }
  }
  return cells
}

function search(remaining, positions, ids, distances, gx, gy, best) {
  if (remaining.length === 0) {
    const { error, pairs } = scorePlacement(ids, positions, distances, gx, gy)
    if (pairs === 0) return
    if (!best.current || error < best.current.error) {
      best.current = { error, pairs, positions: { ...positions } }
    }
    return
  }

  const next = remaining[0]
  const rest = remaining.slice(1)
  const options = adjacentEmpty(positions)
  for (const cell of options) {
    positions[next] = cell
    search(rest, positions, ids, distances, gx, gy, best)
    delete positions[next]
  }
}

/**
 * @param {{
 *   deviceIds: string[],
 *   distances: Record<string, number>,
 *   originId: string,
 *   rightId: string | null,
 *   gx?: number,
 *   gy?: number,
 *   previous?: Record<string, { x: number, y: number }>,
 *   movingId?: string | null,
 *   leftHome?: boolean,
 *   dirs?: Record<string, { toId: string, x: number, y: number, z?: number }>,
 *   axisDir?: Record<string, { x: number, y: number }>,
 * }} input
 */
export function snapGrid(input) {
  const gx = input.gx ?? DEFAULT_GX
  const gy = input.gy ?? DEFAULT_GY
  const originId = input.originId
  const rightId = input.rightId
  const movingId = input.movingId ?? null
  const ids = [...new Set(input.deviceIds)].sort()
  const distances = input.distances ?? {}
  const previous = input.previous ?? {}
  const lifted = []

  if (!originId || !ids.includes(originId)) {
    return { positions: previous, lifted, gx, gy }
  }

  const far = FAR_MULTIPLIER * Math.max(gx, gy)
  const tableIds = []
  for (const id of ids) {
    if (id === originId) {
      tableIds.push(id)
      continue
    }
    let nearest = Infinity
    for (const other of ids) {
      if (other === id) continue
      const d = distances[pairKey(id, other)]
      if (d != null) nearest = Math.min(nearest, d)
    }
    if (!Number.isFinite(nearest)) tableIds.push(id)
    else if (nearest > far) continue
    else tableIds.push(id)
  }

  if (movingId && tableIds.includes(movingId)) {
    const anchors = {}
    for (const id of tableIds) {
      if (id === movingId) continue
      anchors[id] = previous[id] ?? (id === originId ? { x: 0, y: 0 } : null)
      if (!anchors[id]) delete anchors[id]
    }
    if (Object.keys(anchors).length === 0) {
      return { positions: previous, lifted, gx, gy }
    }
    const hasRange = Object.keys(anchors).some(
      (id) => distances[pairKey(movingId, id)] != null,
    )
    if (!hasRange) {
      return { positions: previous, lifted, gx, gy }
    }
    const positions = { ...previous }
    for (const [id, pos] of Object.entries(anchors)) positions[id] = pos
    const fallback =
      previous[movingId] ??
      (movingId === rightId ? { x: 1, y: 0 } : { x: 0, y: 1 })

    const taken = occupiedSet(anchors)
    let nearestId = null
    let nearestD = Infinity
    for (const id of Object.keys(anchors)) {
      const d = distances[pairKey(movingId, id)]
      if (d != null && d < nearestD) {
        nearestD = d
        nearestId = id
      }
    }
    const fromCarry = nearestId
      ? cellFromCarry(
          anchors[nearestId],
          input.carry,
          taken,
          nearestD,
          gx,
          gy,
        )
      : null

    const dirs = input.dirs ?? {}
    const axisDir = input.axisDir ?? {}
    let fromAngle = null
    for (const [anchorId, apos] of Object.entries(anchors)) {
      const report = dirs[anchorId]
      if (!report || report.toId !== movingId) continue
      let referencePhone = axisDir[anchorId]
      let referenceGrid = { x: 1, y: 0 }
      if (anchorId === rightId && originId && previous[originId]) {
        referenceGrid = {
          x: previous[originId].x - apos.x,
          y: previous[originId].y - apos.y,
        }
      } else if (anchorId === originId && rightId && previous[rightId]) {
        referenceGrid = {
          x: previous[rightId].x - apos.x,
          y: previous[rightId].y - apos.y,
        }
      }
      if (!referencePhone && axisDir[originId] && anchorId === originId) {
        referencePhone = axisDir[originId]
      }
      const gridVec = gridVecFromPhone(report, referencePhone, referenceGrid)
      if (!gridVec) continue
      const cell = neighborFromGridVec(apos, gridVec)
      if (!cell || taken.has(`${cell.x},${cell.y}`)) continue
      fromAngle = cell
      break
    }

    positions[movingId] =
      fromCarry ??
      fromAngle ??
      bestCellFor(movingId, anchors, distances, gx, gy, fallback, {
        leftHome: Boolean(input.leftHome),
      })
    return { positions, lifted, gx, gy }
  }

  const seed = {
    [originId]: previous[originId] ?? { x: 0, y: 0 },
  }
  if (!rightId || rightId === originId || !tableIds.includes(rightId)) {
    return {
      positions: { ...pickPrevious(ids.filter((id) => id !== originId), previous, seed), ...seed },
      lifted,
      gx,
      gy,
    }
  }

  seed[rightId] = previous[rightId] ?? { x: 1, y: 0 }

  const remaining = tableIds.filter((id) => !seed[id])
  if (remaining.length === 0) {
    return { positions: seed, lifted, gx, gy }
  }

  const best = { current: null }
  search(remaining, { ...seed }, tableIds, distances, gx, gy, best)

  let positions = best.current?.positions ?? { ...seed, ...pickPrevious(remaining, previous, seed) }

  if (best.current) {
    const prevScore = scorePlacement(tableIds, previous, distances, gx, gy)
    const stillValid = tableIds.every((id) => previous[id]) && !hasOverlap(previous, tableIds)
    if (stillValid && prevScore.pairs > 0) {
      const rmsPrev = Math.sqrt(prevScore.error / prevScore.pairs)
      const rmsBest = Math.sqrt(best.current.error / Math.max(1, best.current.pairs))
      if (rmsPrev <= rmsBest + CLEAR_M) {
        positions = Object.fromEntries(tableIds.map((id) => [id, previous[id]]))
      }
    }
  }

  return { positions, lifted, gx, gy }
}

function hasOverlap(positions, ids) {
  const seen = new Set()
  for (const id of ids) {
    const p = positions[id]
    if (!p) return true
    const key = `${p.x},${p.y}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

function pickPrevious(remaining, previous, seed) {
  const extra = {}
  const taken = new Set(Object.values(seed).map((p) => `${p.x},${p.y}`))
  for (const id of remaining) {
    const p = previous[id]
    if (!p) continue
    const key = `${p.x},${p.y}`
    if (taken.has(key)) continue
    extra[id] = p
    taken.add(key)
  }
  return extra
}

export function calibrateGx(distance) {
  if (!Number.isFinite(distance) || distance < 0.04 || distance > 0.28) return null
  return distance
}

/** Extra chip-to-chip length when phones sit south of each other vs east. */
export const GY_EXTRA_M = 0.075

export function gyFromGx(gx) {
  return Math.min(0.36, gx + GY_EXTRA_M)
}
