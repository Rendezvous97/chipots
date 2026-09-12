import { ART } from '../game/art'
import { useJoinOrigin } from '../useJoinOrigin'

type Props = {
  joining: boolean
  error: string | null
  joinCode: string
  onJoinCode: (value: string) => void
  onCreate: () => void
  onJoin: () => void
  onWatch: () => void
}

const KINDS = ['sheep', 'wheat', 'clay', 'stone'] as const

export function Lobby({
  joining,
  error,
  joinCode,
  onJoinCode,
  onCreate,
  onJoin,
  onWatch,
}: Props) {
  const origin = useJoinOrigin()

  return (
    <div className="splash">
      <div className="splash-glow" />
      <div className="splash-card">
        <div className="element-row">
          {KINDS.map((kind) => (
            <span key={kind} className="element-orb">
              <img src={ART[kind]} alt="" />
            </span>
          ))}
        </div>
        <p className="eyebrow">HackCMU</p>
        <h1>Tabletop</h1>
        <p className="lede splash-lede">
          Phones are windows on one meadow. Gather sheep, wheat, clay, and stone.
          First to hold all four wins.
        </p>

        <div className="banner warn splash-url">
          Phones join at <code>{origin || '…'}</code>
        </div>

        {error && <div className="banner error">{error}</div>}

        <button type="button" className="primary" onClick={onCreate} disabled={joining}>
          {joining ? 'Opening the table…' : 'Create a room'}
        </button>

        <div className="or">sit down with a code</div>

        <form
          className="join"
          onSubmit={(event) => {
            event.preventDefault()
            onJoin()
          }}
        >
          <input
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={4}
            placeholder="ABCD"
            value={joinCode}
            onChange={(event) => onJoinCode(event.target.value.toUpperCase())}
          />
          <button type="submit" disabled={joining || joinCode.length < 4}>
            Join
          </button>
        </form>
        <button
          type="button"
          className="ghost"
          onClick={onWatch}
          disabled={joining || joinCode.length < 4}
        >
          Watch this table
        </button>
      </div>
    </div>
  )
}
