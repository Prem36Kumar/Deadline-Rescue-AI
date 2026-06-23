import { NextRequest, NextResponse } from 'next/server'

interface GeocodeFeature { geometry: { coordinates: [number, number] }; properties: { label?: string } }
function formatDuration(seconds: number) {
  const totalMinutes = Math.round(seconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hrs = Math.floor(totalMinutes / 60), mins = totalMinutes % 60
  return mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`
}
function formatDistance(meters: number) {
  const km = meters / 1000
  return km < 1 ? `${Math.round(meters)} m` : `${km.toFixed(1)} km`
}

export async function POST(req: NextRequest) {
  try {
    const { origin_lat, origin_lng, destination, deadline_iso } = await req.json()
    if (!origin_lat || !origin_lng || !destination || !deadline_iso) {
      return NextResponse.json({ success: false, message: 'Missing required fields.' }, { status: 400 })
    }
    const apiKey = process.env.ORS_API_KEY
    if (!apiKey) return NextResponse.json({ success: false, message: 'ORS_API_KEY is not set on the server.' }, { status: 500 })

    const geoParams = new URLSearchParams({ api_key: apiKey, text: destination, size: '1', 'focus.point.lon': String(origin_lng), 'focus.point.lat': String(origin_lat) })
    const geoRes = await fetch(`https://api.openrouteservice.org/geocode/search?${geoParams.toString()}`)
    const geoJson = await geoRes.json()
    const feature: GeocodeFeature | undefined = geoJson?.features?.[0]
    if (!feature) return NextResponse.json({ success: false, message: 'Could not find that destination. Try a more specific address.' }, { status: 400 })

    const [destLng, destLat] = feature.geometry.coordinates
    const destinationAddress = feature.properties?.label ?? destination

    const dirRes = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [[origin_lng, origin_lat], [destLng, destLat]] }),
    })
    const dirJson = await dirRes.json()
    const routeFeature = dirJson?.features?.[0]
    if (!routeFeature) return NextResponse.json({ success: false, message: 'Could not calculate a driving route to that destination.' }, { status: 400 })

    const summary = routeFeature.properties.summary
    const durationSeconds: number = summary.duration
    const distanceMeters: number = summary.distance
    const bufferSeconds = 10 * 60
    const leaveByMs = new Date(deadline_iso).getTime() - durationSeconds * 1000 - bufferSeconds * 1000

    return NextResponse.json({
      success: true,
      data: {
        leave_by_iso: new Date(leaveByMs).toISOString(),
        duration_text: formatDuration(durationSeconds),
        distance_text: formatDistance(distanceMeters),
        destination_address: destinationAddress,
        destination_lat: destLat,
        destination_lng: destLng,
        route_geometry: routeFeature.geometry.coordinates,
        traffic_aware: false,
      },
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ success: false, message: 'Server error calculating travel time.' }, { status: 500 })
  }
}
