import { getMessaging } from '../config/firebase';
import { logger } from '../middlewares/logger';

export interface RegisterNotificationRequest {
  token: string;
  topics: string[];
  action?: 'subscribe' | 'unsubscribe';
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  topic: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

/**
 * Registers/unregisters an FCM device token for specific topics.
 */
export async function registerTokenForTopics(req: RegisterNotificationRequest): Promise<{ success: boolean; registeredTopics: string[]; action: string }> {
  const { token, topics, action = 'subscribe' } = req;

  if (!token || !Array.isArray(topics) || topics.length === 0) {
    throw new Error('Invalid token or topics array provided');
  }

  const messaging = getMessaging();

  if (!messaging) {
    logger.info({ token, topics, action }, '[MOCK PUSH] Simulating device token topic registration');
    return {
      success: true,
      registeredTopics: topics,
      action,
    };
  }

  const results: string[] = [];
  for (const topic of topics) {
    try {
      const sanitizedTopic = topic.trim().replace(/[^a-zA-Z0-9-_.~%]/g, '_');
      if (action === 'subscribe') {
        await messaging.subscribeToTopic(token, sanitizedTopic);
      } else {
        await messaging.unsubscribeFromTopic(token, sanitizedTopic);
      }
      results.push(sanitizedTopic);
    } catch (error) {
      logger.error({ error, topic, token }, `Failed to ${action} token to topic`);
    }
  }

  return {
    success: true,
    registeredTopics: results,
    action,
  };
}

/**
 * Dispatches a push notification to an FCM topic.
 */
export async function dispatchTopicNotification(payload: PushNotificationPayload): Promise<{ success: boolean; messageId?: string }> {
  const { title, body, topic, data = {}, imageUrl } = payload;
  const messaging = getMessaging();

  const sanitizedTopic = topic.trim().replace(/[^a-zA-Z0-9-_.~%]/g, '_');

  if (!messaging) {
    logger.info({ title, body, topic: sanitizedTopic, data }, '[MOCK PUSH] Dispatched topic push notification');
    return {
      success: true,
      messageId: `mock-msg-${Date.now()}`,
    };
  }

  try {
    const message = {
      notification: {
        title,
        body,
        imageUrl,
      },
      data,
      topic: sanitizedTopic,
    };

    const messageId = await messaging.send(message);
    logger.info({ messageId, topic: sanitizedTopic }, 'Successfully sent FCM topic push notification');
    return { success: true, messageId };
  } catch (error) {
    logger.error({ error, topic: sanitizedTopic }, 'Failed to dispatch FCM push notification');
    throw error;
  }
}
