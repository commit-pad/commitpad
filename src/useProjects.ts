import { useEffect, useState } from 'react'
import type { Project } from '../lib/types'
import { request, errorText } from './api'

export function useProjects() {
  const [items, setItems] = useState<Project[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true, running = false
    const load = async () => {
      if (running) return
      running = true
      try { const data = await request<{ items: Project[] }>('/api/commit/projects'); if (alive) { setItems(data.items); setError('') } }
      catch (e) { if (alive) setError(errorText(e)) }
      finally { running = false; if (alive) setLoading(false) }
    }
    void load(); const timer = setInterval(() => { if (!document.hidden) void load() }, 30000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  return { items, error, loading }
}
