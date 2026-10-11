import { useSyncExternalStore } from 'react'
import { api, getSession, setSession } from './community.js'

/**
 * One session for the whole app: enabled sign-in providers (from /config) and
 * the signed-in user (from /me). Components subscribe with useSession().
 */
const state = { config: null, user: getSession() ? undefined : null, version: 0 } // user undefined = checking
const listeners = new Set()
const emit = () => {
  state.version++
  for (const l of listeners) l()
}

let started = false
function start() {
  if (started) return
  started = true
  api
    .config()
    .then((c) => {
      state.config = c
      emit()
    })
    .catch(() => {
      state.config = { providers: [], invite: null }
      emit()
    })
  if (getSession())
    api
      .me()
      .then((r) => {
        state.user = r.user
        emit()
      })
      .catch(() => {
        setSession(null)
        state.user = null
        emit()
      })
}

const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const snapshot = () => state.version

export function signOut() {
  setSession(null)
  state.user = null
  emit()
}

export function useSession() {
  start()
  useSyncExternalStore(subscribe, snapshot, snapshot)
  return { config: state.config, user: state.user, signOut, setUser: (u) => ((state.user = u), emit()) }
}
