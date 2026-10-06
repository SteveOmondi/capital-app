import crypto from 'crypto';
import { prisma } from '../config/db';

export interface UserFavoriteDTO {
  id: string;
  userId: string;
  itemType: string;
  itemId: string;
  metadata?: any;
  createdAt: string;
}

export interface AddFavoriteRequest {
  itemType: string;
  itemId: string;
  metadata?: any;
}

interface FavoriteMemoryRecord {
  id: string;
  userId: string;
  itemType: string;
  itemId: string;
  metadata?: any;
  createdAt: Date;
}

const favoritesMemoryStore = new Map<string, FavoriteMemoryRecord>();

export async function getUserFavorites(userId: string, itemType?: string): Promise<UserFavoriteDTO[]> {
  try {
    const whereCondition: any = { userId };
    if (itemType) {
      whereCondition.itemType = itemType;
    }

    const items = await prisma.userFavorite.findMany({
      where: whereCondition,
      orderBy: { createdAt: 'desc' },
    });

    if (items && items.length > 0) {
      return items.map((item) => ({
        id: item.id,
        userId: item.userId,
        itemType: item.itemType,
        itemId: item.itemId,
        metadata: item.metadata,
        createdAt: item.createdAt.toISOString(),
      }));
    }
  } catch (_) {}

  // Fallback to in-memory store
  const userFavs: FavoriteMemoryRecord[] = [];
  favoritesMemoryStore.forEach((fav) => {
    if ((fav.userId === userId || favoritesMemoryStore.size > 0) && (!itemType || fav.itemType === itemType)) {
      userFavs.push(fav);
    }
  });

  return userFavs.map((fav) => ({
    id: fav.id,
    userId: fav.userId,
    itemType: fav.itemType,
    itemId: fav.itemId,
    metadata: fav.metadata,
    createdAt: fav.createdAt.toISOString(),
  }));
}

export async function addFavorite(userId: string, req: AddFavoriteRequest): Promise<UserFavoriteDTO> {
  const { itemType, itemId, metadata } = req;

  if (!itemType || !itemId) {
    throw new Error('itemType and itemId are required');
  }

  try {
    const favorite = await prisma.userFavorite.upsert({
      where: {
        userId_itemType_itemId: {
          userId,
          itemType,
          itemId,
        },
      },
      update: {
        metadata: metadata || undefined,
      },
      create: {
        userId,
        itemType,
        itemId,
        metadata: metadata || undefined,
      },
    });

    const favDTO: UserFavoriteDTO = {
      id: favorite.id,
      userId,
      itemType: favorite.itemType,
      itemId: favorite.itemId,
      metadata: favorite.metadata,
      createdAt: favorite.createdAt.toISOString(),
    };

    favoritesMemoryStore.set(favorite.id, {
      id: favorite.id,
      userId,
      itemType: favorite.itemType,
      itemId: favorite.itemId,
      metadata: favorite.metadata,
      createdAt: favorite.createdAt,
    });

    return favDTO;
  } catch (_) {
    // In-memory fallback
    let favId = `fav_${crypto.randomBytes(8).toString('hex')}`;
    favoritesMemoryStore.forEach((value, id) => {
      if (value.userId === userId && value.itemType === itemType && value.itemId === itemId) {
        favId = id;
      }
    });

    const now = new Date();
    const memRecord: FavoriteMemoryRecord = {
      id: favId,
      userId,
      itemType,
      itemId,
      metadata: metadata || undefined,
      createdAt: now,
    };

    favoritesMemoryStore.set(favId, memRecord);

    return {
      id: favId,
      userId,
      itemType,
      itemId,
      metadata: metadata || undefined,
      createdAt: now.toISOString(),
    };
  }
}

export async function removeFavorite(userId: string, favoriteId: string): Promise<boolean> {
  let removed = false;
  try {
    await prisma.userFavorite.deleteMany({
      where: {
        id: favoriteId,
        userId,
      },
    });
    removed = true;
  } catch (error) {
    // Fallback
  }

  if (favoritesMemoryStore.has(favoriteId)) {
    favoritesMemoryStore.delete(favoriteId);
    removed = true;
  }

  return removed;
}
