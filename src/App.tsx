import { useEffect, useMemo, useState } from 'react'
import {
  attachPresence,
  createRoom,
  getDeviceId,
  joinRoom,
  makeRoomCode,
  subscribeRoom,
  watchRoom,
} from './firebase'
import type { RoomState } from './types'
import { Lobby } from './screens/Lobby'
import { Play } from './screens/Play'
import { TableBoard } from './screens/TableBoard'

function params() {
  return new URLSearchParams(window.location.search)
}

function roomFromUrl(): string | null {
  const value = params().get('room')
  return value ? value.toUpperCase() : null
}

function watchFromUrl(): boolean {
  const value = params().get('watch')
  return value === '1' || value === 'true'
}

export default function App() {
  const deviceId = useMemo(() => getDeviceId(), [])
  const [watch, setWatch] = useState(watchFromUrl)
  const [code, setCode] = useState<string | null>(roomFromUrl)
  const [joinCode, setJoinCode] = useState(roomFromUrl() ?? '')
  const [room, setRoom] = useState<RoomState | null>(null)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('is-board', watch)
    return () => document.documentElement.classList.remove('is-board')
  }, [watch])

  useEffect(() => {
    if (!code) return
    let unsubscribe = () => {}
    let cancelled = false
    ;(async () => {
      try {
        setJoining(true)
        if (watch) {
          await watchRoom(code)
        } else {
          await joinRoom(code, deviceId)
          await attachPresence(code, deviceId)
        }
        if (cancelled) return
        unsubscribe = subscribeRoom(code, setRoom)
        const url = new URL(window.location.href)
        url.searchParams.set('room', code)
        if (watch) url.searchParams.set('watch', '1')
        else url.searchParams.delete('watch')
        window.history.replaceState({}, '', url)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not join room')
          setCode(null)
        }
      } finally {
        if (!cancelled) setJoining(false)
      }
    })()
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [code, deviceId, watch])

  const onCreate = async () => {
    setError(null)
    const next = makeRoomCode()
    setJoining(true)
    try {
      await createRoom(next, deviceId)
      setWatch(true)
      setCode(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create room')
    } finally {
      setJoining(false)
    }
  }

  const onJoin = () => {
    setError(null)
    if (joinCode.length < 4) return
    setWatch(false)
    setCode(joinCode)
  }

  if (watch && code && room) {
    return <TableBoard code={code} room={room} />
  }

  if (!watch && code && room?.devices[deviceId]) {
    return <Play code={code} deviceId={deviceId} room={room} />
  }

  return (
    <Lobby
      joining={joining}
      error={error}
      joinCode={joinCode}
      onJoinCode={setJoinCode}
      onCreate={() => void onCreate()}
      onJoin={onJoin}
      onWatch={() => {
        setError(null)
        if (joinCode.length < 4) return
        setWatch(true)
        setCode(joinCode)
      }}
    />
  )
}
