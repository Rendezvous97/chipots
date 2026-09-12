import { useEffect, useState } from 'react'
import { fetchJoinOrigin } from './room'

export function useJoinOrigin() {
  const [origin, setOrigin] = useState(
    typeof window === 'undefined' ? '' : window.location.origin,
  )

  useEffect(() => {
    void fetchJoinOrigin().then(setOrigin)
  }, [])

  return origin
}
