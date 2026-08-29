```
```

# 🔌 WordPress Developer Integration Guide

This guide provides technical specifications, JSON payload contracts, and ready-to-use PHP snippets for integrating **WordPress CMS** with the **Capital FM Mobile Backend Gateway** for instant push notifications and article cache sync.

---

## 🌐 API Gateway Base URLs

- **Production URL**: `https://ca-capital-backend-api.salmonwave-7494888b.eastus.azurecontainerapps.io/`
- **Development URL**: `http://localhost:3000`

---

## 🔑 Authentication & Security

All webhook HTTP requests sent from WordPress to the Backend Gateway MUST include the security secret header:

```http
x-webhook-secret: YOUR_WP_WEBHOOK_SECRET
Content-Type: application/json
```

---

## 1. 📰 Webhook: Article / Breaking News Published

Notify the mobile backend gateway whenever a news post is published or updated in WordPress.

- **Endpoint**: `POST /api/v1/webhooks/wordpress/post-published`
- **Trigger Hook in WP**: `transition_post_status` or `publish_post`

### JSON Request Payload

```json
{
  "postId": 10452,
  "title": "Breaking News: Expressway Traffic Flow Restored",
  "excerpt": "Traffic flow restored on Expressway following clear lanes at toll stations.",
  "category": "breaking_news",
  "slug": "expressway-traffic-flow-restored",
  "coverImageUrl": "https://www.capitalfm.africa/wp-content/uploads/2026/08/traffic.jpg"
}
```

### Response Payload (`200 OK`)

```json
{
  "status": "success",
  "message": "Breaking news push notification dispatched successfully.",
  "data": {
    "success": true,
    "messageId": "projects/capital-fm-app/messages/0:1787745..."
  }
}
```

---

## 2. 🎙️ Webhook: Podcast Episode Published

Notify the mobile backend gateway whenever a new podcast episode is published.

- **Endpoint**: `POST /api/v1/webhooks/podcasts/episode-published`
- **Trigger Hook in WP**: `publish_podcast` or custom podcast post type hook

### JSON Request Payload

```json
{
  "podcastId": "financial-fitness",
  "episodeId": "ep-42",
  "title": "The Financial Fitness Masterclass Ep 42",
  "description": "Expert advice on personal wealth management and investment strategies.",
  "audioUrl": "https://stream.capitalfm.africa/podcasts/financial-fitness-ep42.mp3",
  "coverImageUrl": "https://www.capitalfm.africa/podcasts/covers/ep42.jpg"
}
```

### Response Payload (`200 OK`)

```json
{
  "status": "success",
  "message": "Podcast episode push notification dispatched successfully.",
  "data": {
    "success": true,
    "messageId": "projects/capital-fm-app/messages/0:1787746..."
  }
}
```

---

## 🐘 Ready-to-Use WordPress PHP Code Snippet

Add this code to your WordPress theme's `functions.php` or a custom plugin (e.g. `capital-push-webhooks.php`):

```php
<?php
/**
 * Plugin Name: Capital FM Mobile Push Notification Webhooks
 * Description: Triggers push notifications via Mobile Backend Gateway when posts or podcasts are published.
 */

if (!defined('ABSPATH')) exit;

define('CAPITAL_BACKEND_URL', 'https://ca-capital-backend-api.salmonwave-7494888b.eastus.azurecontainerapps.io/');
define('CAPITAL_WEBHOOK_SECRET', 'capital_fm_secret_webhook_key_2026');

/**
 * Trigger Webhook on Post Publish
 */
add_action('transition_post_status', 'capital_notify_mobile_on_publish', 10, 3);

function capital_notify_mobile_on_publish($new_status, $old_status, $post) {
    // Only trigger when transitioning to 'publish' status for standard posts
    if ($new_status !== 'publish' || $old_status === 'publish' || $post->post_type !== 'post') {
        return;
    }

    $categories = get_the_category($post->ID);
    $category_slug = !empty($categories) ? $categories[0]->slug : 'breaking_news';
    $thumbnail_url = get_the_post_thumbnail_url($post->ID, 'full');

    $payload = array(
        'postId'        => $post->ID,
        'title'         => get_the_title($post->ID),
        'excerpt'       => get_the_excerpt($post->ID),
        'category'      => $category_slug,
        'slug'          => $post->post_name,
        'coverImageUrl' => $thumbnail_url ? $thumbnail_url : ''
    );

    wp_remote_post(CAPITAL_BACKEND_URL . '/api/v1/webhooks/wordpress/post-published', array(
        'headers' => array(
            'Content-Type'     => 'application/json',
            'x-webhook-secret' => CAPITAL_WEBHOOK_SECRET,
        ),
        'body'        => wp_json_encode($payload),
        'timeout'     => 5,
        'blocking'    => false, // Non-blocking async execution
    ));
}
```
