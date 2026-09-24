import { Injectable } from '@nestjs/common';
import type { WorkerProfileInput } from '@onsite/validation';
import { ConflictError, NotFoundError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WorkersService {
  constructor(private readonly prisma: PrismaService) {}

  async createProfile(userId: string, input: WorkerProfileInput) {
    const existing = await this.prisma.workerProfile.findUnique({ where: { userId } });
    if (existing) throw new ConflictError('A worker profile already exists for this account.');

    const categories = await this.prisma.category.findMany({
      where: { slug: { in: input.categorySlugs }, isActive: true },
      select: { id: true },
    });
    if (categories.length === 0) {
      throw new NotFoundError('None of the selected categories are currently active.');
    }

    const profile = await this.prisma.workerProfile.create({
      data: {
        userId,
        baseLat: input.baseLocation.latitude,
        baseLng: input.baseLocation.longitude,
        baseCity: input.baseCity,
        workingRadiusMeters: input.workingRadiusMeters,
        categories: { create: categories.map((c) => ({ categoryId: c.id })) },
      },
      include: { categories: { include: { category: true } } },
    });

    return this.toView(profile);
  }

  async updateProfile(userId: string, input: Partial<WorkerProfileInput>) {
    const existing = await this.requireProfile(userId);

    if (input.categorySlugs) {
      const categories = await this.prisma.category.findMany({
        where: { slug: { in: input.categorySlugs }, isActive: true },
        select: { id: true },
      });
      await this.prisma.$transaction([
        this.prisma.workerCategory.deleteMany({ where: { workerProfileId: existing.id } }),
        this.prisma.workerCategory.createMany({
          data: categories.map((c) => ({ workerProfileId: existing.id, categoryId: c.id })),
        }),
      ]);
    }

    const profile = await this.prisma.workerProfile.update({
      where: { userId },
      data: {
        ...(input.baseLocation && {
          baseLat: input.baseLocation.latitude,
          baseLng: input.baseLocation.longitude,
        }),
        ...(input.baseCity !== undefined && { baseCity: input.baseCity }),
        ...(input.workingRadiusMeters !== undefined && {
          workingRadiusMeters: input.workingRadiusMeters,
        }),
      },
      include: { categories: { include: { category: true } } },
    });

    return this.toView(profile);
  }

  async setAvailability(userId: string, isAvailable: boolean) {
    await this.requireProfile(userId);
    const profile = await this.prisma.workerProfile.update({
      where: { userId },
      data: { isAvailable, lastActiveAt: new Date() },
      include: { categories: { include: { category: true } } },
    });
    return this.toView(profile);
  }

  async getSelf(userId: string) {
    // Called for its existence check; the fetch below needs the category relations anyway.
    await this.requireProfile(userId);
    const full = await this.prisma.workerProfile.findUniqueOrThrow({
      where: { userId },
      include: { categories: { include: { category: true } } },
    });
    return this.toView(full);
  }

  async getStats(userId: string) {
    const profile = await this.requireProfile(userId);
    return {
      ratingAvg: profile.ratingAvg,
      ratingCount: profile.ratingCount,
      tasksCompleted: profile.tasksCompleted,
      tasksAccepted: profile.tasksAccepted,
      tasksOffered: profile.tasksOffered,
      completionRate: profile.completionRate,
      responseRate: profile.responseRate,
    };
  }

  private async requireProfile(userId: string) {
    const profile = await this.prisma.workerProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundError('Create a worker profile first.');
    return profile;
  }

  private toView(profile: {
    id: string;
    baseLat: number;
    baseLng: number;
    baseCity: string;
    workingRadiusMeters: number;
    isAvailable: boolean;
    categories: { category: { slug: string; name: string } }[];
  }) {
    return {
      id: profile.id,
      baseLocation: { latitude: profile.baseLat, longitude: profile.baseLng },
      baseCity: profile.baseCity,
      workingRadiusMeters: profile.workingRadiusMeters,
      isAvailable: profile.isAvailable,
      categories: profile.categories.map((c) => ({
        slug: c.category.slug,
        name: c.category.name,
      })),
    };
  }
}
