import { describe, expect, it } from 'vitest';
import { toPlace } from './places.service';

describe('toPlace — turning an OpenStreetMap result into a picker suggestion', () => {
  it('builds one readable line, most specific first, without repeating parts', () => {
    const place = toPlace({
      geometry: { coordinates: [72.5603, 23.0276] },
      properties: {
        name: 'Iscon Mall',
        housenumber: '12',
        street: 'CG Road',
        district: 'Navrangpura',
        city: 'Ahmedabad',
        county: 'Ahmedabad',
        state: 'Gujarat',
        postcode: '380009',
        countrycode: 'IN',
      },
    });
    expect(place).toEqual({
      name: 'Iscon Mall',
      address: 'Iscon Mall, 12 CG Road, Navrangpura, Ahmedabad, Gujarat, 380009',
      latitude: 23.0276,
      longitude: 72.5603,
    });
  });

  it('drops results outside India, even if the search bbox let them through', () => {
    expect(toPlace({ geometry: { coordinates: [80.6, 7.3] }, properties: { name: 'Kandy', countrycode: 'LK' } })).toBeNull();
    expect(toPlace({ geometry: { coordinates: [-0.12, 51.5] }, properties: { name: 'London' } })).toBeNull();
  });

  it('drops results with no coordinates or no name at all', () => {
    expect(toPlace({ properties: { name: 'Nowhere', countrycode: 'IN' } })).toBeNull();
    expect(toPlace({ geometry: { coordinates: [72.5, 23.0] }, properties: { countrycode: 'IN' } })).toBeNull();
  });
});
