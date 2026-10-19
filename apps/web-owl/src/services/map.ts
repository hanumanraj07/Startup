import type { Map as MapLibreMap, MapOptions, StyleSpecification } from 'maplibre-gl';
import { config } from '@/lib/config';

export type { MapLibreMap };

/**
 * MapLibre GL, loaded on demand. It is by far the largest dependency, so it
 * never ships in the main bundle: only screens that actually show a map pay
 * for it, and only when they open (docs/20's feed budget stays untouched).
 */
let loading: Promise<typeof import('maplibre-gl')> | null = null;

export function loadMapLibre(): Promise<typeof import('maplibre-gl')> {
  if (!loading) {
    loading = Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([mod]) => mod);
    // A failed chunk load (offline, deploy in between) must not poison every later attempt.
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** OpenStreetMap raster tiles, with the attribution their licence requires. */
export function osmStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [config.mapTileUrl],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
}

/** A map on `container`, or null when this device cannot draw one (no WebGL). */
export async function createMap(container: HTMLElement, options: Omit<MapOptions, 'container' | 'style'>): Promise<MapLibreMap | null> {
  const maplibre = await loadMapLibre();
  try {
    const map = new maplibre.Map({
      container,
      style: osmStyle(),
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      ...options,
    });
    map.touchZoomRotate.disableRotation();
    return map;
  } catch {
    return null;
  }
}
