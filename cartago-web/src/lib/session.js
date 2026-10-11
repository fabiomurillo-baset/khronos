import { useState } from 'react'
import { api, getSession, setSession } from './community.js'

/** Enabled sign-in providers (from the API) and the signed-in user, shared by every panel that needs sign-in. */
export function useSession() {
  const [config, setConfig] = useState(null)
  // undefined = checking the stored token, null = signed out
  const [user, setUser] = useState(() => (getSession() ? undefined : null))
  const [started, setStarted] = useState(false)
  if (!started) {
    setStarted(true)
    api.config().then(setConfig).catch(() => setConfig({ providers: [], invite: null }))
    if (getSession())
      api
        .me()
        .then((r) => setUser(r.user))
        .catch(() => {
          setSession(null)
          setUser(null)
        })
  }
  const signOut = () => {
    setSession(null)
    setUser(null)
  }
  return { config, user, signOut, setUser }
}
