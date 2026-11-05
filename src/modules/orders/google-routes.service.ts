import { Injectable, Logger } from '@nestjs/common';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface RouteResult {
  encodedPolyline: string;
  coordinates: [number, number][]; // [latitude, longitude][]
  distanceMeters: number;
  distanceKm: string;
  durationSeconds: number;
  durationMinutes: number;
  travelMode: string;
  fallbackTravelMode?: boolean;
  isRealRoute: boolean; // true for verified Google Routes road geometry, false for straight-line reference
  isStraightLineReference?: boolean;
  routeUnavailable?: boolean;
  computedAt: string;
}

interface CacheEntry {
  result: RouteResult;
  expiresAt: number;
}

@Injectable()
export class GoogleRoutesService {
  private readonly logger = new Logger(GoogleRoutesService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 60000; // 60-second cache

  private getApiKey(): string | undefined {
    return (
      process.env.GOOGLE_MAPS_ROUTES_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.CUSTOMER_GOOGLE_MAPS_ANDROID_API_KEY ||
      process.env.DRIVER_GOOGLE_MAPS_ANDROID_API_KEY
    );
  }

  /**
   * Decode a Google-encoded polyline string into an array of [latitude, longitude] pairs.
   */
  public decodePolyline(encoded: string): [number, number][] {
    const points: [number, number][] = [];
    let index = 0;
    const len = encoded.length;
    let lat = 0;
    let lng = 0;

    while (index < len) {
      let b: number;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
      lng += dlng;

      points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
  }

  /**
   * Computes authoritative driving/two-wheeler route between origin and destination using Google Routes API v2.
   */
  public async computeRoute(
    origin: LatLng,
    destination: LatLng,
    preferredTravelMode: 'TWO_WHEELER' | 'DRIVE' = 'TWO_WHEELER',
  ): Promise<RouteResult> {
    const cacheKey = `${origin.latitude.toFixed(4)},${origin.longitude.toFixed(4)}->${destination.latitude.toFixed(4)},${destination.longitude.toFixed(4)}:${preferredTravelMode}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('Google Maps API key not configured, generating geodesic corridor route');
      const fallback = this.generateFallbackRoute(origin, destination, preferredTravelMode);
      return fallback;
    }

    try {
      // 1. First attempt with preferred travel mode (e.g. TWO_WHEELER)
      const result = await this.callGoogleRoutesApi(origin, destination, preferredTravelMode, apiKey);
      if (result) {
        this.cache.set(cacheKey, { result, expiresAt: Date.now() + this.CACHE_TTL_MS });
        return result;
      }
    } catch (err: any) {
      this.logger.warn(`Routes API with ${preferredTravelMode} failed: ${err.message}. Retrying with DRIVE.`);
    }

    // 2. Fallback to standard DRIVE mode if TWO_WHEELER is unavailable in region or rejected
    if (preferredTravelMode === 'TWO_WHEELER') {
      try {
        const result = await this.callGoogleRoutesApi(origin, destination, 'DRIVE', apiKey);
        if (result) {
          result.fallbackTravelMode = true;
          this.cache.set(cacheKey, { result, expiresAt: Date.now() + this.CACHE_TTL_MS });
          return result;
        }
      } catch (driveErr: any) {
        this.logger.error(`Routes API DRIVE fallback failed: ${driveErr.message}`);
      }
    }

    // 3. Fallback route when network or external Google API fails
    const fallbackResult = this.generateFallbackRoute(origin, destination, preferredTravelMode);
    return fallbackResult;
  }

  private async callGoogleRoutesApi(
    origin: LatLng,
    destination: LatLng,
    travelMode: 'TWO_WHEELER' | 'DRIVE',
    apiKey: string,
  ): Promise<RouteResult | null> {
    const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
    const body = {
      origin: {
        location: {
          latLng: {
            latitude: origin.latitude,
            longitude: origin.longitude,
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: destination.latitude,
            longitude: destination.longitude,
          },
        },
      },
      travelMode: travelMode === 'TWO_WHEELER' ? 'TWO_WHEELER' : 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: false,
      polylineQuality: 'HIGH_QUALITY',
      polylineEncoding: 'ENCODED_POLYLINE',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google Routes API returned status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const route = data.routes?.[0];
    if (!route || !route.polyline?.encodedPolyline) {
      return null;
    }

    const encodedPolyline = route.polyline.encodedPolyline;
    const coordinates = this.decodePolyline(encodedPolyline);
    const distanceMeters = route.distanceMeters || 0;
    // duration string format: "360s" or "120.5s"
    const durationSeconds = route.duration
      ? parseInt(route.duration.replace('s', ''), 10)
      : Math.round(distanceMeters / 6.94); // default ~25km/h city speed in seconds

    return {
      encodedPolyline,
      coordinates,
      distanceMeters,
      distanceKm: (distanceMeters / 1000).toFixed(1) + ' km',
      durationSeconds,
      durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
      travelMode,
      isRealRoute: true,
      isStraightLineReference: false,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Generates an explicitly labelled straight-line reference when Google Routes API is unreachable.
   * Never fabricates synthetic road curves.
   */
  private generateFallbackRoute(
    origin: LatLng,
    destination: LatLng,
    travelMode: string,
  ): RouteResult {
    // Explicit straight-line reference geometry: direct line from origin to destination
    const coordinates: [number, number][] = [
      [origin.latitude, origin.longitude],
      [destination.latitude, destination.longitude],
    ];

    // Haversine distance
    const R = 6371e3;
    const phi1 = (origin.latitude * Math.PI) / 180;
    const phi2 = (destination.latitude * Math.PI) / 180;
    const deltaPhi = ((destination.latitude - origin.latitude) * Math.PI) / 180;
    const deltaLambda = ((destination.longitude - origin.longitude) * Math.PI) / 180;
    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceMeters = Math.round(R * c);
    const durationSeconds = Math.round(distanceMeters / 6.94); // ~25 km/h avg estimate

    return {
      encodedPolyline: '',
      coordinates,
      distanceMeters,
      distanceKm: (distanceMeters / 1000).toFixed(1) + ' km',
      durationSeconds,
      durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
      travelMode,
      fallbackTravelMode: true,
      isRealRoute: false,
      isStraightLineReference: true,
      computedAt: new Date().toISOString(),
    };
  }
}

