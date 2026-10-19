import { Injectable, Logger } from '@nestjs/common';
import { BusinessRuleError } from '../../common/errors';
import { loadEnv } from '../../config/env';
import { isWithinIndiaBounds } from '../../repositories/geo.repository';

/** One result for the map picker. A suggestion only: the user confirms the point on the map. */
export interface PlaceView {
  name: string;
  /** A readable one-line address, most specific part first. */
  address: string;
  latitude: number;
  longitude: number;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    housenumber?: string;
    street?: string;
    locality?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    postcode?: string;
    countrycode?: string;
  };
}

/** India's bounding box for Photon's bbox filter: minLon,minLat,maxLon,maxLat. */
const INDIA_BBOX = '68,6,98,38';
const TIMEOUT_MS = 5_000;
const SEARCH_LIMIT = 6;

/**
 * Place search and reverse geocoding for the task location picker, on
 * OpenStreetMap data via Photon (no key). Founder decision 2026-10-19:
 * OpenStreetMap only. Results are suggestions; the point the user confirms on
 * the map is what is stored, and the server still checks it is in India.
 *
 * Proxied through the API rather than called from the browser so the provider
 * can be changed in one place, requests carry an honest User-Agent (part of
 * fair use of the public instance), and per-user rate limits apply. Searches
 * leave the API to the provider, so they are not logged here beyond errors.
 */
@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);

  async search(query: string, near?: { lat: number; lng: number }): Promise<PlaceView[]> {
    const env = loadEnv();
    if (env.GEOCODING_PROVIDER === 'mock') return mockSearch(query, near);

    const params = new URLSearchParams({ q: query, limit: String(SEARCH_LIMIT), lang: 'en', bbox: INDIA_BBOX });
    if (near) {
      params.set('lat', String(near.lat));
      params.set('lon', String(near.lng));
    }
    const features = await this.photon(`/api/?${params.toString()}`);
    return features.map(toPlace).filter((p): p is PlaceView => p !== null);
  }

  async reverse(lat: number, lng: number): Promise<PlaceView | null> {
    if (!isWithinIndiaBounds(lat, lng)) {
      throw new BusinessRuleError('That point is outside India.');
    }
    const env = loadEnv();
    if (env.GEOCODING_PROVIDER === 'mock') return mockReverse(lat, lng);

    const params = new URLSearchParams({ lat: String(lat), lon: String(lng), lang: 'en', limit: '1' });
    const [first] = await this.photon(`/reverse?${params.toString()}`);
    return first ? toPlace(first) : null;
  }

  /** Never throws for a provider problem: the picker still works by moving the map, just without suggestions. */
  private async photon(path: string): Promise<PhotonFeature[]> {
    const env = loadEnv();
    try {
      const res = await fetch(`${env.GEOCODING_OSM_URL}${path}`, {
        headers: { 'User-Agent': `OnSite/1.0 (+${env.WEB_URL})`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Place search returned ${res.status}.`);
        return [];
      }
      const body = (await res.json()) as { features?: PhotonFeature[] };
      return body.features ?? [];
    } catch (error) {
      this.logger.warn(`Place search unavailable: ${String(error)}`);
      return [];
    }
  }
}

/** Indian results only, as one readable line without repeated parts. */
export function toPlace(feature: PhotonFeature): PlaceView | null {
  const [lng, lat] = feature.geometry?.coordinates ?? [];
  const p = feature.properties ?? {};
  if (lat === undefined || lng === undefined) return null;
  if ((p.countrycode && p.countrycode.toUpperCase() !== 'IN') || !isWithinIndiaBounds(lat, lng)) return null;

  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const parts = [p.name, street, p.locality, p.district, p.city ?? p.county, p.state, p.postcode];
  const seen = new Set<string>();
  const unique = parts.filter((part): part is string => {
    if (!part) return false;
    const key = part.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) return null;
  return { name: unique[0] ?? '', address: unique.join(', '), latitude: lat, longitude: lng };
}

// ─── Mock provider (tests, offline development) ───────────────────────────

const MOCK_PLACES: PlaceView[] = [
  { name: 'CG Road', address: 'CG Road, Navrangpura, Ahmedabad, Gujarat, 380009', latitude: 23.0276, longitude: 72.5603 },
  { name: 'Manek Chowk', address: 'Manek Chowk, Old City, Ahmedabad, Gujarat, 380001', latitude: 23.0225, longitude: 72.5878 },
  { name: 'Park Street', address: 'Park Street, Kolkata, West Bengal, 700016', latitude: 22.5526, longitude: 88.3527 },
  { name: 'Chandni Chowk', address: 'Chandni Chowk, Kolkata, West Bengal, 700072', latitude: 22.5646, longitude: 88.3526 },
];

function mockSearch(query: string, _near?: { lat: number; lng: number }): PlaceView[] {
  const q = query.toLowerCase();
  return MOCK_PLACES.filter((p) => p.address.toLowerCase().includes(q));
}

function mockReverse(lat: number, lng: number): PlaceView {
  return { name: 'Dropped pin', address: `Near ${lat.toFixed(5)}, ${lng.toFixed(5)}`, latitude: lat, longitude: lng };
}
