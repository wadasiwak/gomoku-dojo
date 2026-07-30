// 極簡 hash routing：view state 同步 URL hash（#/play、#/replay/<棋譜> 可分享）。
// GoatCounter 只回報 pathname（index.html），hash 不進 analytics。
import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'play'; record?: string }
  | { name: 'puzzles'; tab: string }
  | { name: 'puzzle'; id: string }
  | { name: 'records' }
  | { name: 'replay'; record: string }
  | { name: 'study'; record?: string }
  | { name: 'rules' }
  | { name: 'resources' }
  | { name: 'openings'; sub: string | null }

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '')
  const [head, ...rest] = h.split('/')
  switch (head) {
    case 'play':
      return rest.length > 0 ? { name: 'play', record: rest.join('/') } : { name: 'play' }
    case 'puzzles':
      return { name: 'puzzles', tab: rest[0] ?? 'all' }
    case 'puzzle':
      return rest[0] ? { name: 'puzzle', id: rest[0] } : { name: 'puzzles', tab: 'all' }
    case 'records':
      return { name: 'records' }
    case 'replay':
      return { name: 'replay', record: rest.join('/') }
    case 'study':
      return rest.length > 0 ? { name: 'study', record: rest.join('/') } : { name: 'study' }
    case 'rules':
      return { name: 'rules' }
    case 'resources':
      return { name: 'resources' }
    case 'openings':
      return { name: 'openings', sub: rest[0] ?? null }
    default:
      return { name: 'home' }
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(hash: string): void {
  location.hash = hash
}
