import { Request, Response, NextFunction } from 'express';
import { getPodcastChannel, getWebsiteRssPodcastChannel, getPodcastGroups, getPodcastEpisodes } from '../services/podcastService';

export async function getPodcastsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;
    const group = req.query.group ? String(req.query.group) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;

    if (group || search) {
      const epResult = await getPodcastEpisodes({ group, search, page, limit });
      res.status(200).json({
        status: 'success',
        data: {
          title: 'Capital FM Kenya Podcasts',
          description: 'Tune into Capital FM Kenya top podcasts, interviews, and audio shows.',
          link: 'https://www.capitalfm.africa',
          totalEpisodes: epResult.total,
          page: epResult.page,
          limit: epResult.limit,
          episodes: epResult.episodes,
        },
      });
      return;
    }

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

export async function getPodcastGroupsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const groups = await getPodcastGroups();
    res.status(200).json({
      status: 'success',
      data: {
        total: groups.length,
        groups,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getPodcastEpisodesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;
    const group = req.query.group ? String(req.query.group) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;

    const result = await getPodcastEpisodes({ group, search, page, limit });

    res.status(200).json({
      status: 'success',
      data: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        episodes: result.episodes,
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
