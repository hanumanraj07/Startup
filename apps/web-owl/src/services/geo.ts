/**
 * The device's current position, or null if unavailable or denied. This is
 * evidence, not fact: the server measures it against the task location and
 * flags a mismatch; the client never computes or asserts a distance.
 */
export function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });
}
