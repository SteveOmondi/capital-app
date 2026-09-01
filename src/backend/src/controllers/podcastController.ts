import { Request, Response, NextFunction } from 'express';
import { getPodcastChannel, getWebsiteRssPodcastChannel } from '../services/podcastService';

export async function getPodcastsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;

    const channel = await getPodcastChannel();
    const startIndex = (page - 1) * limit;
    const paginatedEpisodes = channel.episodes.slice(startIndex, startIndex + limit);

    res.status(200).json({
      status: 'success',
      data: {
        title: channel.title,
        description: channel.description,
        link: channel.link,
        imageUrl: channel.imageUrl,
        totalEpisodes: channel.episodes.length,
        page,
        limit,
        episodes: paginatedEpisodes,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getRssPodcastsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;

    const channel = await getWebsiteRssPodcastChannel();
    const startIndex = (page - 1) * limit;
    const paginatedEpisodes = channel.episodes.slice(startIndex, startIndex + limit);

    res.status(200).json({
      status: 'success',
      data: {
        title: channel.title,
        description: channel.description,
        link: channel.link,
        imageUrl: channel.imageUrl,
        totalEpisodes: channel.episodes.length,
        page,
        limit,
        episodes: paginatedEpisodes,
      },
    });
  } catch (error) {
    next(error);
  }
}
