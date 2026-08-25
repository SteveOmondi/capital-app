import { Request, Response, NextFunction } from 'express';
import { registerTokenForTopics, dispatchTopicNotification } from '../services/notificationService';
import { config } from '../config';
import { stripHtml } from '../utils/htmlStripper';

export async function registerNotificationHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, topics, action } = req.body;

    if (!token || !topics) {
      res.status(400).json({
        status: 'error',
        message: 'Device FCM token and topics array are required.',
      });
      return;
    }

    const result = await registerTokenForTopics({ token, topics, action });

    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function wordpressPostPublishedWebhookHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const secret = req.headers['x-webhook-secret'];
    if (secret !== config.security.wpWebhookSecret) {
      res.status(401).json({
        status: 'error',
        message: 'Unauthorized webhook request. Invalid secret header.',
      });
      return;
    }

    const { postId, title, excerpt, category, slug, coverImageUrl } = req.body;

    const cleanTitle = stripHtml(title || 'Breaking News Update');
    const cleanBody = stripHtml(excerpt || cleanTitle);
    const targetTopic = category && category !== 'all' ? category : 'breaking_news';

    const dispatchResult = await dispatchTopicNotification({
      title: cleanTitle,
      body: cleanBody,
      topic: targetTopic,
      imageUrl: coverImageUrl,
      data: {
        type: 'article',
        postId: String(postId || ''),
        slug: String(slug || ''),
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Breaking news push notification dispatched successfully.',
      data: dispatchResult,
    });
  } catch (error) {
    next(error);
  }
}

export async function podcastEpisodePublishedWebhookHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const secret = req.headers['x-webhook-secret'];
    if (secret !== config.security.wpWebhookSecret) {
      res.status(401).json({
        status: 'error',
        message: 'Unauthorized webhook request. Invalid secret header.',
      });
      return;
    }

    const { podcastId, episodeId, title, description, audioUrl, coverImageUrl } = req.body;

    const cleanTitle = stripHtml(title || 'New Podcast Episode');
    const cleanBody = stripHtml(description || cleanTitle);
    const targetTopic = podcastId ? `podcast_${podcastId}` : 'podcast_episodes';

    const dispatchResult = await dispatchTopicNotification({
      title: cleanTitle,
      body: cleanBody,
      topic: targetTopic,
      imageUrl: coverImageUrl,
      data: {
        type: 'podcast',
        podcastId: String(podcastId || ''),
        episodeId: String(episodeId || ''),
        audioUrl: String(audioUrl || ''),
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Podcast episode push notification dispatched successfully.',
      data: dispatchResult,
    });
  } catch (error) {
    next(error);
  }
}
