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

export async function getUserFavorites(userId: string, itemType?: string): Promise<UserFavoriteDTO[]> {
  const whereCondition: any = { userId };
  if (itemType) {
    whereCondition.itemType = itemType;
  }

  const items = await prisma.userFavorite.findMany({
    where: whereCondition,
    orderBy: { createdAt: 'desc' },
  });

  return items.map((item) => ({
    id: item.id,
    userId: item.userId,
    itemType: item.itemType,
    itemId: item.itemId,
    metadata: item.metadata,
    createdAt: item.createdAt.toISOString(),
  }));
}

export async function addFavorite(userId: string, req: AddFavoriteRequest): Promise<UserFavoriteDTO> {
  const { itemType, itemId, metadata } = req;

  if (!itemType || !itemId) {
    throw new Error('itemType and itemId are required');
  }

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

  return {
    id: favorite.id,
    userId: favorite.userId,
    itemType: favorite.itemType,
    itemId: favorite.itemId,
    metadata: favorite.metadata,
    createdAt: favorite.createdAt.toISOString(),
  };
}

export async function removeFavorite(userId: string, favoriteId: string): Promise<boolean> {
  try {
    await prisma.userFavorite.deleteMany({
      where: {
        id: favoriteId,
        userId,
      },
    });
    return true;
  } catch (error) {
    return false;
  }
}
