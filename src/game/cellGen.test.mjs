import assert from 'node:assert/strict'
import test from 'node:test'
import { generateCell, hitResource } from './cellGen.mjs'

test('same cell and seed always match', () => {
  const a = generateCell(2, -1, 99)
  const b = generateCell(2, -1, 99)
  assert.deepEqual(a, b)
  assert.notDeepEqual(generateCell(2, -1, 98), a)
})

test('every cell is one authored background', () => {
  const seen = new Set()
  for (let i = 0; i < 80; i++) {
    const view = generateCell(i % 10, Math.floor(i / 10), 7)
    assert.ok(view.background)
    assert.equal(view.props.length, 0)
    assert.ok(view.resources.length <= 3)
    seen.add(view.background)
  }
  assert.ok(seen.has('frame4') || seen.has('frame6') || seen.has('frame7'))
  assert.ok(seen.has('grass') || seen.has('frame3') || seen.has('frame5'))
})

test('clay only on dirt and sheep not on open water tiles', () => {
  for (let i = 0; i < 200; i++) {
    const view = generateCell(i, 3, 11)
    for (const item of view.resources) {
      if (item.kind === 'clay') assert.equal(view.tags.dirt, true)
      if (item.kind === 'sheep') {
        assert.equal(view.background === 'frame4' || view.background === 'frame6', false)
      }
      if (item.kind === 'wheat' && view.background !== 'frame7') {
        assert.equal(view.tags.water, false)
      }
    }
  }
})

test('hit testing finds a centered resource', () => {
  const view = generateCell(0, 0, 1)
  view.resources = [{ kind: 'wheat', layer: 'resource', x: 0.5, y: 0.5, scale: 0.35, key: '0,0:wheat:0' }]
  const hit = hitResource(view, {}, 0.5, 0.51)
  assert.equal(hit?.key, '0,0:wheat:0')
  assert.equal(hitResource(view, { '0,0:wheat:0': 'p' }, 0.5, 0.5), null)
})
