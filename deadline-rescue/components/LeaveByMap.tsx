'use client'
import { useEffect, useRef, useState } from 'react'

interface LeaveByMapProps { deadlineIso: string | null; taskName: string; autoSuggestTravel?: boolean }
interface LeaveByResult {
  leave_by_iso: string; duration_text: string; distance_text: string
  destination_address: string; destination_lat: number; destination_lng: number
  route_geometry: [number, number][]; traffic_aware: boolean
}
declare global { interface Window { L?: any } }

function loadLeaflet(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (window.L) { resolve(window.L); return }
    const cssId = 'leaflet-css'
    if (!document.getElementById(cssId)) {
      const link = document.createElement('link')
      link.id = cssId; link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
    const scriptId = 'leaflet-js'
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null
    if (existing) { existing.addEventListener('load', () => resolve(window.L)); return }
    const script = document.createElement('script')
    script.id = scriptId; script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.async = true
    script.onload = () => resolve(window.L); script.onerror = reject
    document.body.appendChild(script)
  })
}

export default function LeaveByMap({ deadlineIso, taskName, autoSuggestTravel }: LeaveByMapProps) {
  const [destination, setDestination] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<LeaveByResult | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const mapDivRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null }, [])

  useEffect(() => {
    if (!data || !coords || !mapDivRef.current) return
    let cancelled = false
    loadLeaflet().then((L) => {
      if (cancelled || !mapDivRef.current) return
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
      const map = L.map(mapDivRef.current, { zoomControl: false, attributionControl: true })
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map)
      const latlngs = data.route_geometry.map(([lng, lat]) => [lat, lng]) as [number, number][]
      const line = L.polyline(latlngs, { color: '#7c6fff', weight: 4 }).addTo(map)
      L.marker([coords.lat, coords.lng]).addTo(map).bindPopup('You')
      L.marker([data.destination_lat, data.destination_lng]).addTo(map).bindPopup(data.destination_address)
      map.fitBounds(line.getBounds(), { padding: [24, 24] })
    })
    return () => { cancelled = true }
  }, [data, coords])

  if (!deadlineIso) return null
  const travelHint = autoSuggestTravel && !data

  function calculate() {
    if (!destination.trim()) { setError('Enter where you need to go'); return }
    setLoading(true); setError(''); setData(null)
    if (!('geolocation' in navigator)) { setError('Location access is not supported on this device/browser.'); setLoading(false); return }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords
        setCoords({ lat: latitude, lng: longitude })
        try {
          const res = await fetch('/api/leave-by', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ origin_lat: latitude, origin_lng: longitude, destination, deadline_iso: deadlineIso }),
          })
          const json = await res.json()
          if (!res.ok || !json.success) { setError(json.message ?? 'Could not calculate travel time'); return }
          setData(json.data)
        } catch { setError('Network error while calculating route.') } finally { setLoading(false) }
      },
      () => { setError('Location permission denied. Allow location access and try again.'); setLoading(false) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
      <p className="font-mono text-xs uppercase tracking-widest" style={{ color: 'var(--text3)' }}>🗺 Leave-by calculator</p>
      {autoSuggestTravel && !data && (
        <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(124,111,255,0.08)', border: '1px solid var(--accent-glow)', color: 'var(--accent)' }}>
          🤖 Agent detected this needs travel — enter the venue to calculate leave-by time
        </p>
      )}
      <div className="flex gap-2">
        <input value={destination} onChange={(e) => setDestination(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') calculate() }}
          placeholder={autoSuggestTravel ? `Where is the ${taskName} venue? e.g. Razorpay office, Bangalore` : `Where is "${taskName}"? e.g. BESCOM office, Whitefield`} className="flex-1 text-sm rounded-lg px-3 py-2"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} />
        <button onClick={calculate} disabled={loading} className="px-4 rounded-lg text-xs font-semibold"
          style={{ background: 'var(--accent)', color: 'white', opacity: loading ? 0.7 : 1 }}>{loading ? '...' : 'Go'}</button>
      </div>
      {error && <p className="text-xs" style={{ color: '#ff8899' }}>{error}</p>}
      {data && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg p-3" style={{ background: 'rgba(124,111,255,.08)', border: '1px solid var(--accent-glow)' }}>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>Leave by</p>
            <p className="text-lg font-bold" style={{ color: 'var(--accent)' }}>
              {new Date(data.leave_by_iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text2)' }}>{data.distance_text} · {data.duration_text} to {data.destination_address}</p>
          </div>
          <div ref={mapDivRef} className="w-full rounded-lg" style={{ height: 220, border: '1px solid var(--border)' }} />
          <a href={`https://www.google.com/maps/dir/?api=1&origin=${coords?.lat},${coords?.lng}&destination=${data.destination_lat},${data.destination_lng}&travelmode=driving`}
            target="_blank" rel="noreferrer" className="text-xs text-center py-2 rounded-lg" style={{ border: '1px solid var(--border)', color: 'var(--text2)' }}>
            Open in Google Maps →
          </a>
        </div>
      )}
    </div>
  )
}
