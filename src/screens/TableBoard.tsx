import { useMemo } from 'react'
import type { DeviceState, RoomState } from '../types'
import { backgroundLabel, generateCell, visibleResources } from '../game/cellGen.mjs'
import { RESOURCE_LABEL } from '../game/art'
import { BIOME_STYLE, biomeAt, cellKey } from '../game/world'

type Props = {
  code: string
  room: RoomState
}

function short(id: string) {
  return id.slice(0, 4).toUpperCase()
}

export function TableBoard({ code, room }: Props) {
  const devices = Object.entries(room.devices)
  const uwb = room.uwb
  const bounds = useMemo(() => {
    const cells = devices.map(([, d]) => ({ x: d.worldX, y: d.worldY }))
    if (cells.length === 0) cells.push({ x: 0, y: 0 })
    let minX = Math.min(...cells.map((c) => c.x)) - 1
    let maxX = Math.max(...cells.map((c) => c.x)) + 1
    let minY = Math.min(...cells.map((c) => c.y)) - 1
    let maxY = Math.max(...cells.map((c) => c.y)) + 1
    if (maxX - minX < 3) maxX = minX + 3
    if (maxY - minY < 3) maxY = minY + 3
    return { minX, maxX, minY, maxY }
  }, [room.devices])

  const cols = bounds.maxX - bounds.minX + 1
  const rows = bounds.maxY - bounds.minY + 1
  const byCell = new Map<string, [string, DeviceState][]>()
  for (const entry of devices) {
    const key = cellKey(entry[1].worldX, entry[1].worldY)
    const list = byCell.get(key) ?? []
    list.push(entry)
    byCell.set(key, list)
  }

  return (
    <div className="board">
      <header className="board-head">
        <div>
          <p className="eyebrow">Spectator board</p>
          <h1>Room {code}</h1>
          <p className="muted">
            This tab is a spectator. It does not sit on the grid. +Y is toward the
            bottom of the screen (south).
            {room.winnerId
              ? ` Winner: ${room.devices[room.winnerId]?.name || 'a player'}.`
              : ' First to hold sheep, wheat, clay, and stone wins.'}
          </p>
        </div>
        <dl className="board-meta">
          <div>
            <dt>Phones</dt>
            <dd>{devices.length}</dd>
          </div>
          <div>
            <dt>Calibrated</dt>
            <dd>{uwb?.calibrated ? 'yes' : 'no'}</dd>
          </div>
          <div>
            <dt>Gx / Gy</dt>
            <dd>
              {uwb ? `${Math.round(uwb.gx * 100)} / ${Math.round(uwb.gy * 100)} cm` : '—'}
            </dd>
          </div>
          <div>
            <dt>Snap</dt>
            <dd>
              {uwb?.needSnap
                ? `pending ${uwb.movingId ? short(uwb.movingId) : ''}`
                : 'idle'}
            </dd>
          </div>
        </dl>
      </header>

      <div className="board-body">
        <div
          className="board-grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(140px, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(140px, 1fr))`,
          }}
        >
          {Array.from({ length: rows }, (_, row) =>
            Array.from({ length: cols }, (_, col) => {
              const x = bounds.minX + col
              const y = bounds.minY + row
              const biome = biomeAt(x, y)
              const style = BIOME_STYLE[biome]
              const here = byCell.get(cellKey(x, y)) ?? []
              const view = generateCell(x, y, room.worldSeed ?? 1)
              const loot = visibleResources(view, room.collected ?? {})
              return (
                <div
                  key={cellKey(x, y)}
                  className={`board-cell${here.length ? ' is-occupied' : ''}`}
                  style={{ background: view.tags.water ? '#2a7a7a' : view.tags.dirt ? '#8a6236' : style.fill }}
                >
                  <div className="board-cell-label">
                    ({x}, {y}) · {backgroundLabel(view.background)}
                    {loot.length
                      ? ` · ${loot.map((item: { kind: string }) => RESOURCE_LABEL[item.kind] ?? item.kind).join(', ')}`
                      : ''}
                  </div>
                  {here.map(([id, device]) => (
                    <article
                      key={id}
                      className={`board-phone${device.status === 'lifted' ? ' is-lifted' : ''}`}
                      style={{ borderColor: device.color }}
                    >
                      <div className="board-phone-id" style={{ color: device.color }}>
                        {short(id)}
                      </div>
                      <div>{device.status === 'lifted' ? 'in hand' : 'on table'}</div>
                      <div className="board-tags">
                        {uwb?.originId === id && <span>origin</span>}
                        {uwb?.rightId === id && <span>right</span>}
                        {uwb?.movingId === id && <span>moving</span>}
                      </div>
                    </article>
                  ))}
                </div>
              )
            }),
          )}
        </div>

        <aside className="board-side">
          <h2>Phones</h2>
          {devices.length === 0 && <p className="muted">Waiting for phones to join…</p>}
          <ul className="board-list">
            {devices.map(([id, device]) => (
              <li key={id}>
                <span className="swatch" style={{ background: device.color }} />
                <div>
                  <strong>{short(id)}</strong>
                  <div className="muted">
                    cell ({device.worldX}, {device.worldY}) · {device.status}
                    {uwb?.originId === id ? ' · origin' : ''}
                    {uwb?.rightId === id ? ' · right' : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <h2>UWB ranges</h2>
          <ul className="board-list">
            {Object.entries(uwb?.ranges ?? {}).map(([pair, d]) => (
              <li key={pair}>
                <div>
                  <strong>{pair}</strong>
                  <div className="muted">{Math.round(d * 100)} cm</div>
                </div>
              </li>
            ))}
            {Object.keys(uwb?.ranges ?? {}).length === 0 && (
              <li className="muted">No live ranges yet</li>
            )}
          </ul>
          <h2>Angles</h2>
          <ul className="board-list">
            {Object.entries(uwb?.bearings ?? {}).map(([pair, b]) => (
              <li key={pair}>
                <div>
                  <strong>{pair}</strong>
                  <div className="muted">
                    {b.compass} · x {b.x.toFixed(2)} y {b.y.toFixed(2)}
                  </div>
                </div>
              </li>
            ))}
            {Object.keys(uwb?.bearings ?? {}).length === 0 && (
              <li className="muted">No AoA yet — keep screens up, phones facing the same way</li>
            )}
          </ul>
        </aside>
      </div>
    </div>
  )
}
