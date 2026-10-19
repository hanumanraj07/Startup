import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  placeSearchSchema,
  reverseGeocodeSchema,
  type PlaceSearchInput,
  type ReverseGeocodeInput,
} from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { PlacesService } from './places.service';

// Search-as-you-type is debounced in the client; this is the ceiling per user.
const PLACES_THROTTLE = { user: { limit: 60, ttl: 60_000 } };

/** The task location picker's search and "what is here" lookups. Signed-in users only. */
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Throttle(PLACES_THROTTLE)
  @Get('search')
  async search(@Query(zodPipe(placeSearchSchema)) query: PlaceSearchInput) {
    const near = query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : undefined;
    return { data: await this.places.search(query.q, near) };
  }

  @Throttle(PLACES_THROTTLE)
  @Get('reverse')
  async reverse(@Query(zodPipe(reverseGeocodeSchema)) query: ReverseGeocodeInput) {
    return { data: await this.places.reverse(query.lat, query.lng) };
  }
}
