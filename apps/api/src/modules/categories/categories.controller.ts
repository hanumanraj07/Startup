import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

interface CategoryView {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  suggestedMinPaise: number;
  suggestedMaxPaise: number;
  defaultProofRequirements: unknown;
  /** SINGLE: one place. PICKUP_DROPOFF: collect at the task location, deliver to a drop-off. */
  locationMode: 'SINGLE' | 'PICKUP_DROPOFF';
}

interface CityView {
  id: string;
  name: string;
  state: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

/**
 * Public reference data.
 *
 * Only active rows are returned, which is how the launch scope is enforced: a
 * category or city that is not active cannot be selected, and widening the
 * scope is an admin action rather than a deploy.
 */
@Controller()
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('categories')
  async listCategories(): Promise<{ data: CategoryView[] }> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    // "Other" goes last, after every named category, wherever categories are picked.
    rows.sort((a, b) => Number(a.slug === 'other') - Number(b.slug === 'other'));

    // An explicit projection, never the entity itself.
    return {
      data: rows.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        icon: c.icon,
        suggestedMinPaise: Number(c.suggestedMinPaise),
        suggestedMaxPaise: Number(c.suggestedMaxPaise),
        defaultProofRequirements: c.defaultProofRequirements,
        locationMode: c.locationMode,
      })),
    };
  }

  @Public()
  @Get('cities')
  async listCities(): Promise<{ data: CityView[] }> {
    const rows = await this.prisma.city.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    return {
      data: rows.map((c) => ({
        id: c.id,
        name: c.name,
        state: c.state,
        latitude: c.centerLat,
        longitude: c.centerLng,
        radiusMeters: c.radiusMeters,
      })),
    };
  }
}
