import { useEffect, useState } from 'react'
import { fetchJoinOrigin } from './firebase'

export function useJoinOrigin() {
  const [origin, setOrigin] = useState(
    typeof window === 'undefined' ? '' : window.location.origin,
  )

  useEffect(() => {
    void fetchJoinOrigin().then(setOrigin)
  }, [])

  return origin
}
