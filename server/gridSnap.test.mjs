import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_GX, DEFAULT_GY, gridVecFromPhone, neighborFromGridVec, pairKey, snapGrid } from './gridSnap.mjs'

test('places a 1x2 row from origin + right', () => {
  const a = 'a'
  const b = 'b'
  const result = snapGrid({
    deviceIds: [a, b],
    distances: { [pairKey(a, b)]: DEFAULT_GX },
    originId: a,
    rightId: b,
  })
  assert.deepEqual(result.positions[a], { x: 0, y: 0 })
  assert.deepEqual(result.positions[b], { x: 1, y: 0 })
})

test('snaps a third phone below the origin', () => {
  const a = 'a'
  const b = 'b'
  const c = 'c'
  const result = snapGrid({
    deviceIds: [a, b, c],
    distances: {
      [pairKey(a, b)]: DEFAULT_GX,
      [pairKey(a, c)]: DEFAULT_GY,
      [pairKey(b, c)]: Math.hypot(DEFAULT_GX, DEFAULT_GY),
    },
    originId: a,
    rightId: b,
    previous: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
  })
  assert.deepEqual(result.positions[c], { x: 0, y: 1 })
})

test('keeps the current cell when distance jitters', () => {
  const result = snapGrid({
    deviceIds: ['a', 'b'],
    distances: { [pairKey('a', 'b')]: 0.18 },
    originId: 'a',
    rightId: 'b',
    gx: 0.15,
    gy: 0.28,
    previous: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
    movingId: 'b',
  })
  assert.deepEqual(result.positions.b, { x: 1, y: 0 })
})

test('snaps below only when distance clearly matches Gy', () => {
  const result = snapGrid({
    deviceIds: ['a', 'b'],
    distances: { [pairKey('a', 'b')]: 0.29 },
    originId: 'a',
    rightId: 'b',
    gx: 0.15,
    gy: 0.28,
    previous: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
    movingId: 'b',
  })
  assert.equal(result.positions.b.x, 0)
  assert.equal(Math.abs(result.positions.b.y), 1)
})

test('beside after touching-calibrate stays on the row', () => {
  const result = snapGrid({
    deviceIds: ['a', 'b'],
    distances: { [pairKey('a', 'b')]: 0.16 },
    originId: 'a',
    rightId: 'b',
    gx: 0.09,
    gy: 0.19,
    previous: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
    movingId: 'b',
  })
  assert.deepEqual(result.positions.b, { x: 1, y: 0 })
  assert.deepEqual(result.positions.a, { x: 0, y: 0 })
})

test('does not move the table phone when the origin is placed', () => {
  const result = snapGrid({
    deviceIds: ['a', 'b'],
    distances: { [pairKey('a', 'b')]: 0.29 },
    originId: 'a',
    rightId: 'b',
    gx: 0.15,
    gy: 0.28,
    previous: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
    movingId: 'a',
  })
  assert.deepEqual(result.positions.b, { x: 1, y: 0 })
  assert.equal(result.positions.a.x, 1)
  assert.equal(Math.abs(result.positions.a.y), 1)
})

test('walk around to the other side of the row', () => {
  const result = snapGrid({
    deviceIds: ['a', 'b'],
    distances: { [pairKey('a', 'b')]: 0.12 },
    originId: 'a',
    rightId: 'b',
    gx: 0.12,
    gy: 0.25,
    previous: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
    movingId: 'a',
    leftHome: true,
  })
  assert.deepEqual(result.positions.b, { x: 1, y: 0 })
  assert.deepEqual(result.positions.a, { x: 2, y: 0 })
})

test('angle from the table phone picks south over east', () => {
  const a = 'a'
  const b = 'b'
  const result = snapGrid({
    deviceIds: [a, b],
    distances: { [pairKey(a, b)]: 0.22 },
    originId: a,
    rightId: b,
    gx: 0.14,
    gy: 0.22,
    previous: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
    movingId: b,
    dirs: { a: { toId: b, x: 0.1, y: -0.9, z: 0.1 } },
    axisDir: { a: { x: 0.95, y: 0.05 } },
  })
  assert.deepEqual(result.positions.a, { x: 0, y: 0 })
  assert.equal(result.positions.b.x, 0)
  assert.equal(result.positions.b.y, 1)
})

test('maps phone-top toward negative grid Y by default', () => {
  const vec = gridVecFromPhone({ x: 0, y: 1 }, null, null)
  assert.ok(vec)
  assert.ok(Math.abs(vec.x) < 0.01)
  assert.ok(vec.y < 0)
  const cell = neighborFromGridVec({ x: 0, y: 0 }, vec)
  assert.deepEqual(cell, { x: 0, y: -1 })
})

test('IMU carry toward the bottom of the phone sits south', () => {
  const result = snapGrid({
    deviceIds: ['a', 'b'],
    distances: { [pairKey('a', 'b')]: 0.16 },
    originId: 'a',
    rightId: 'b',
    gx: 0.14,
    gy: 0.22,
    previous: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
    movingId: 'b',
    carry: { x: 0.08, y: -0.12 },
  })
  assert.deepEqual(result.positions.a, { x: 0, y: 0 })
  assert.deepEqual(result.positions.b, { x: 0, y: 1 })
})

test('sideways carry does not override a short side-by-side range', () => {
  const result = snapGrid({
    deviceIds: ['a', 'b'],
    distances: { [pairKey('a', 'b')]: 0.18 },
    originId: 'a',
    rightId: 'b',
    gx: 0.197,
    gy: 0.272,
    previous: { a: { x: 1, y: 0 }, b: { x: 0, y: 0 } },
    movingId: 'b',
    carry: { x: 0.02, y: 0.15 },
  })
  assert.equal(result.positions.b.y, 0)
  assert.equal(Math.abs(result.positions.b.x - 1), 1)
})

test('leaves a far phone on its last cell instead of in-hand', () => {
  const result = snapGrid({
    deviceIds: ['a', 'b'],
    distances: { [pairKey('a', 'b')]: 1.4 },
    originId: 'a',
    rightId: 'b',
    previous: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
  })
  assert.deepEqual(result.lifted, [])
  assert.deepEqual(result.positions.a, { x: 0, y: 0 })
  assert.deepEqual(result.positions.b, { x: 1, y: 0 })
})



