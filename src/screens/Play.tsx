import { useEffect, useMemo, useRef, useState } from 'react'
import type { Inventory, RoomState, TradeOffer } from '../types'
import { GameCanvas } from '../game/canvas'
import { backgroundLabel, generateCell } from '../game/cellGen.mjs'
import { ART, RESOURCE_LABEL } from '../game/art'
import { collectResource, offerTrade, respondTrade, sayHello } from '../firebase'

type Props = {
  code: string
  deviceId: string
  room: RoomState
}

const KINDS = ['sheep', 'wheat', 'clay', 'stone'] as const
const NAME_KEY = 'tabletop-player-name'

function emptyGoods(): Inventory {
  return { sheep: 0, wheat: 0, clay: 0, stone: 0 }
}

function storedName() {
  try {
    return (
      new URLSearchParams(window.location.search).get('name') ||
      localStorage.getItem(NAME_KEY) ||
      ''
    ).trim()
  } catch {
    return ''
  }
}

function goodsLine(bag: Inventory) {
  const bits = KINDS.filter((kind) => bag[kind] > 0).map(
    (kind) => `${bag[kind]} ${RESOURCE_LABEL[kind].toLowerCase()}`,
  )
  return bits.join(', ') || 'nothing'
}

export function Play({ deviceId, room }: Props) {
  const me = room.devices[deviceId]
  const seed = room.worldSeed ?? 1
  const view = me ? generateCell(me.worldX, me.worldY, seed) : null
  const inv = me?.inventory ?? emptyGoods()
  const lifted = me?.status === 'lifted'
  const others = useMemo(
    () => Object.entries(room.devices).filter(([id]) => id !== deviceId),
    [room.devices, deviceId],
  )

  const [pending, setPending] = useState<Record<string, string>>({})
  const [showcase, setShowcase] = useState<{ kind: string; label: string } | null>(null)
  const [tradeOpen, setTradeOpen] = useState(false)
  const [peerId, setPeerId] = useState('')
  const [offer, setOffer] = useState<Inventory>(emptyGoods)
  const [ask, setAsk] = useState<Inventory>(emptyGoods)
  const [nameDraft, setNameDraft] = useState(storedName)
  const [nameError, setNameError] = useState<string | null>(null)
  const [tradeNews, setTradeNews] = useState<TradeOffer | null>(null)
  const seenTrades = useRef(new Set<string>())

  const collected = useMemo(
    () => ({ ...(room.collected ?? {}), ...pending }),
    [room.collected, pending],
  )

  const incoming = Object.values(room.trades ?? {}).filter(
    (trade) => trade.to === deviceId && trade.status === 'pending',
  )
  const outgoing = Object.values(room.trades ?? {}).filter(
    (trade) => trade.from === deviceId && trade.status === 'pending',
  )
  const winner = room.winnerId ? room.devices[room.winnerId] : null

  useEffect(() => {
    setPending((prev) => {
      const next = { ...prev }
      let changed = false
      for (const key of Object.keys(next)) {
        if (room.collected?.[key]) {
          delete next[key]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [room.collected])

  useEffect(() => {
    if (!me || me.name) return
    const saved = storedName()
    if (saved) sayHello(saved)
  }, [me])

  useEffect(() => {
    if (incoming.length > 0) setTradeOpen(true)
  }, [incoming.length])

  useEffect(() => {
    for (const trade of Object.values(room.trades ?? {})) {
      if (trade.from !== deviceId && trade.to !== deviceId) continue
      if (trade.status === 'pending') continue
      const key = `${trade.id}:${trade.status}`
      if (seenTrades.current.has(key)) continue
      seenTrades.current.add(key)
      setTradeNews(trade)
      setTradeOpen(false)
    }
  }, [room.trades, deviceId])

  if (!me) {
    return (
      <div className="splash">
        <div className="splash-card">
          <p className="eyebrow">Tabletop</p>
          <h1>Rejoining…</h1>
        </div>
      </div>
    )
  }

  const needsName = !me.name

  const submitName = () => {
    const next = nameDraft.trim().slice(0, 18)
    if (next.length < 2) {
      setNameError('Use at least 2 letters')
      return
    }
    try {
      localStorage.setItem(NAME_KEY, next)
    } catch {
      /* ignore */
    }
    sayHello(next)
  }

  return (
    <div className={`play ${lifted ? 'is-lifted' : ''}`}>
      <GameCanvas
        worldX={me.worldX}
        worldY={me.worldY}
        worldSeed={seed}
        collected={collected}
        lifted={lifted || needsName || Boolean(winner)}
        onCollect={(key, kind) => {
          setPending((prev) => ({ ...prev, [key]: deviceId }))
          collectResource(key, me.worldX, me.worldY)
          setShowcase({ kind, label: RESOURCE_LABEL[kind] ?? kind })
          window.setTimeout(() => setShowcase(null), 2200)
          window.setTimeout(() => {
            setPending((prev) => {
              if (!(key in prev)) return prev
              const next = { ...prev }
              delete next[key]
              return next
            })
          }, 3500)
        }}
      />

      <PackCard
        name={me.name || 'Unnamed'}
        place={view ? backgroundLabel(view.background) : 'Field'}
        inv={inv}
        incoming={incoming.length}
        onOpenTrade={() => setTradeOpen(true)}
      />

      {showcase && !winner && (
        <div className="obtain" onClick={() => setShowcase(null)}>
          <div className="obtain-card">
            <p>You found</p>
            <img src={ART[showcase.kind]} alt="" />
            <strong>{showcase.label}</strong>
          </div>
        </div>
      )}

      {incoming.length > 0 && !tradeOpen && !winner && (
        <button type="button" className="trade-ping" onClick={() => setTradeOpen(true)}>
          <p className="eyebrow">Trade offer</p>
          <strong>{room.devices[incoming[0].from]?.name || 'Player'} wants to trade</strong>
          <span>Tap to review</span>
        </button>
      )}

      {tradeNews && !winner && (
        <div className="obtain" onClick={() => setTradeNews(null)}>
          <div className="obtain-card trade-news">
            <p>
              {tradeNews.status === 'done'
                ? 'Trade complete'
                : tradeNews.status === 'declined'
                  ? 'Offer declined'
                  : 'Trade failed'}
            </p>
            <strong>
              {tradeNews.status === 'done'
                ? tradeNews.to === deviceId
                  ? `You got ${goodsLine(tradeNews.offer)}`
                  : `You got ${goodsLine(tradeNews.ask)}`
                : tradeNews.to === deviceId
                  ? 'You passed on the offer'
                  : `${room.devices[tradeNews.to]?.name || 'They'} passed`}
            </strong>
            {tradeNews.status === 'done' && (
              <div className="state-inv news-inv">
                {KINDS.map((kind) => (
                  <span key={kind} className="state-chip">
                    <img src={ART[kind]} alt="" />
                    {inv[kind]}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tradeOpen && !winner && (
        <TradeSheet
          meName={me.name || 'You'}
          inventory={inv}
          others={others}
          peerId={peerId}
          onPeer={setPeerId}
          offer={offer}
          ask={ask}
          onOffer={setOffer}
          onAsk={setAsk}
          incoming={incoming}
          outgoing={outgoing}
          devices={room.devices}
          onClose={() => setTradeOpen(false)}
          onSend={() => {
            if (!peerId) return
            offerTrade(peerId, offer, ask)
            setOffer(emptyGoods())
            setAsk(emptyGoods())
          }}
        />
      )}

      {lifted && !needsName && !winner && (
        <div className="lifted-overlay">
          <div>
            <h2>Carrying</h2>
            <p>Set the phone down to open a new cell.</p>
          </div>
        </div>
      )}

      {needsName && (
        <div className="name-gate splash">
          <form
            className="splash-card"
            onSubmit={(event) => {
              event.preventDefault()
              submitName()
            }}
          >
            <ElementRow />
            <p className="eyebrow">Take a seat</p>
            <h1>What should we call you?</h1>
            <p className="lede">Your name shows up on trades around the table.</p>
            <input
              autoFocus
              maxLength={18}
              placeholder="Ada"
              value={nameDraft}
              onChange={(event) => {
                setNameDraft(event.target.value)
                setNameError(null)
              }}
            />
            {nameError && <div className="banner error">{nameError}</div>}
            <button type="submit" className="primary">
              Enter the meadow
            </button>
          </form>
        </div>
      )}

      {winner && (
        <div className="win-gate splash">
          <div className="splash-card win-card">
            <p className="eyebrow">{room.winnerId === deviceId ? 'You win' : 'Gathered'}</p>
            <h1>{winner.name || 'A player'} collected all four</h1>
            <ElementRow />
            <p className="lede">Sheep, wheat, clay, and stone — the table is complete.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function ElementRow() {
  return (
    <div className="element-row">
      {KINDS.map((kind) => (
        <span key={kind} className="element-orb">
          <img src={ART[kind]} alt="" />
        </span>
      ))}
    </div>
  )
}

function PackCard({
  name,
  place,
  inv,
  incoming,
  onOpenTrade,
}: {
  name: string
  place: string
  inv: Inventory
  incoming: number
  onOpenTrade: () => void
}) {
  const [pos, setPos] = useState({ x: 12, y: 12 })
  const [collapsed, setCollapsed] = useState(false)
  const drag = useRef<{
    pointer: number
    dx: number
    dy: number
    moved: boolean
  } | null>(null)

  const onPointerDown = (event: React.PointerEvent) => {
    const target = event.target as HTMLElement
    if (target.closest('button.pack-action')) return
    drag.current = {
      pointer: event.pointerId,
      dx: event.clientX - pos.x,
      dy: event.clientY - pos.y,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag.current || drag.current.pointer !== event.pointerId) return
    const nextX = event.clientX - drag.current.dx
    const nextY = event.clientY - drag.current.dy
    if (Math.hypot(nextX - pos.x, nextY - pos.y) > 6) drag.current.moved = true
    const w = collapsed ? 168 : 236
    const h = collapsed ? 52 : 148
    setPos({
      x: Math.max(8, Math.min(window.innerWidth - w - 8, nextX)),
      y: Math.max(8, Math.min(window.innerHeight - h - 8, nextY)),
    })
  }

  const onPointerUp = (event: React.PointerEvent) => {
    if (!drag.current || drag.current.pointer !== event.pointerId) return
    const moved = drag.current.moved
    drag.current = null
    if (moved) return
    if (collapsed) setCollapsed(false)
    else onOpenTrade()
  }

  return (
    <div
      className={`state-card ${collapsed ? 'is-collapsed' : ''}`}
      style={{ left: pos.x, top: pos.y, right: 'auto' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="state-who">
        <div>
          <span className="state-name">{name}</span>
          {!collapsed && <span className="state-place">{place}</span>}
        </div>
        <div className="pack-tools">
          {incoming > 0 && <span className="pack-badge">{incoming}</span>}
          <button
            type="button"
            className="pack-action"
            onClick={(event) => {
              event.stopPropagation()
              setCollapsed((value) => !value)
            }}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        </div>
      </div>
      <div className="state-inv">
        {KINDS.map((kind) => (
          <span key={kind} className="state-chip">
            <img src={ART[kind]} alt="" />
            {inv[kind]}
          </span>
        ))}
      </div>
      {!collapsed && <div className="state-hint">Drag to move · tap to trade</div>}
    </div>
  )
}

function TradeSheet({
  meName,
  inventory,
  others,
  peerId,
  onPeer,
  offer,
  ask,
  onOffer,
  onAsk,
  incoming,
  outgoing,
  devices,
  onClose,
  onSend,
}: {
  meName: string
  inventory: Inventory
  others: [string, RoomState['devices'][string]][]
  peerId: string
  onPeer: (id: string) => void
  offer: Inventory
  ask: Inventory
  onOffer: (next: Inventory) => void
  onAsk: (next: Inventory) => void
  incoming: TradeOffer[]
  outgoing: TradeOffer[]
  devices: RoomState['devices']
  onClose: () => void
  onSend: () => void
}) {
  const canSend =
    Boolean(peerId) &&
    KINDS.some((kind) => offer[kind] > 0) &&
    KINDS.some((kind) => ask[kind] > 0) &&
    KINDS.every((kind) => offer[kind] <= inventory[kind])

  return (
    <div className="trade-scrim" onClick={onClose}>
      <div className="trade-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">Trade</p>
            <h2>{meName}’s pack</h2>
          </div>
          <button type="button" className="ghost tight" onClick={onClose}>
            Close
          </button>
        </header>

        {incoming.map((trade) => (
          <div key={trade.id} className="trade-offer incoming">
            <p>
              <strong>{devices[trade.from]?.name || 'Player'}</strong> offers{' '}
              {goodsLine(trade.offer)} for {goodsLine(trade.ask)}
            </p>
            <div className="row">
              <button type="button" className="primary" onClick={() => respondTrade(trade.id, true)}>
                Accept
              </button>
              <button type="button" className="ghost tight" onClick={() => respondTrade(trade.id, false)}>
                Decline
              </button>
            </div>
          </div>
        ))}

        {outgoing.map((trade) => (
          <p key={trade.id} className="muted">
            Waiting on {devices[trade.to]?.name || 'player'} for {goodsLine(trade.offer)} →{' '}
            {goodsLine(trade.ask)}
          </p>
        ))}

        {others.length === 0 ? (
          <p className="muted">Need another phone at the table to trade.</p>
        ) : (
          <>
            <label className="trade-label">With</label>
            <div className="peer-row">
              {others.map(([id, device]) => (
                <button
                  key={id}
                  type="button"
                  className={id === peerId ? 'peer on' : 'peer'}
                  onClick={() => onPeer(id)}
                >
                  {device.name || 'Player'}
                </button>
              ))}
            </div>
            <GoodsEditor title="You give" goods={offer} cap={inventory} onChange={onOffer} />
            <GoodsEditor title="You want" goods={ask} onChange={onAsk} />
            <button type="button" className="primary" disabled={!canSend} onClick={onSend}>
              Send offer
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function GoodsEditor({
  title,
  goods,
  cap,
  onChange,
}: {
  title: string
  goods: Inventory
  cap?: Inventory
  onChange: (next: Inventory) => void
}) {
  return (
    <div className="goods">
      <label className="trade-label">{title}</label>
      <div className="goods-grid">
        {KINDS.map((kind) => (
          <div key={kind} className="goods-cell">
            <img src={ART[kind]} alt="" />
            <span>{RESOURCE_LABEL[kind]}</span>
            <div className="stepper">
              <button
                type="button"
                onClick={() => onChange({ ...goods, [kind]: Math.max(0, goods[kind] - 1) })}
              >
                −
              </button>
              <strong>{goods[kind]}</strong>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...goods,
                    [kind]: Math.min(cap ? cap[kind] : 9, goods[kind] + 1, 9),
                  })
                }
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
