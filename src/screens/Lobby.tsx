import { ART } from '../game/art'
import { useJoinOrigin } from '../useJoinOrigin'

type Props = {
  joining: boolean
  error: string | null
  joinCode: string
  onJoinCode: (value: string) => void
  onCreate: () => void
  onWatch: () => void
}

const KINDS = ['sheep', 'wheat', 'clay', 'stone'] as const

export function Lobby({
  joining,
  error,
  joinCode,
  onJoinCode,
  onCreate,
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
          This laptop is a spectator. Players join from the NearbyTable iOS app
          on the same Wi‑Fi. Gather sheep, wheat, clay, and stone — first to hold
          all four wins.
        </p>

        <div className="banner warn splash-url">
          Phones talk to <code>{origin || '…'}</code>
        </div>

        {error && <div className="banner error">{error}</div>}

        <button type="button" className="primary" onClick={onCreate} disabled={joining}>
          {joining ? 'Opening the table…' : 'Create a room'}
        </button>

        <div className="or">watch an existing table</div>

        <form
          className="join"
          onSubmit={(event) => {
            event.preventDefault()
            onWatch()
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
            Watch
          </button>
        </form>
      </div>
    </div>
  )
}
