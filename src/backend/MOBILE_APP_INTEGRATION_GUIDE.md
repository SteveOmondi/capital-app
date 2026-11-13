# 📱 Mobile App Developer Integration Guide

This document provides complete API contracts, endpoint specifications, JSON DTO payloads, and ready-to-use **Dart / Flutter** client code for integrating the **Capital FM Mobile Application** (iOS & Android) with the **Node.js Backend Gateway**.

---

## 🌐 API Gateway Base URLs

- **Production Gateway URL**: `https://ca-capital-backend-api.southafricanorth.azurecontainerapps.io`
- **Local Dev Gateway URL**: `http://localhost:3000` *(Use `http://10.0.2.2:3000` for Android Emulator)*
- **Interactive Swagger Documentation**: `https://ca-capital-backend-api.southafricanorth.azurecontainerapps.io/docs`

---

## 1. 📰 News Articles & Category Filtering

### 1.1 Discover News Categories
- **Endpoint**: `GET /api/v1/news/categories`
- **Response**:
```json
{
  "status": "success",
  "data": {
    "total": 7,
    "categories": [
      { "id": 1, "name": "News", "slug": "news", "count": 450, "description": "Latest breaking news" },
      { "id": 2, "name": "Sports", "slug": "sports", "count": 210, "description": "Football & athletics updates" },
      { "id": 3, "name": "Business", "slug": "business", "count": 180, "description": "Finance and market news" }
    ]
  }
}
```

### 1.2 Fetch News Feed / Search Articles
- **Endpoint**: `GET /api/v1/news`
- **Query Params**:
  - `category` (optional, e.g. `sports`, `business` or `all`)
  - `author` (optional, e.g. `jane-doe` or `42` to filter by author)
  - `page` (default: 1)
  - `limit` (default: 10, max: 50)
  - `search` (optional, full-text search term e.g. `nairobi`)
- **Response**:
```json
{
  "status": "success",
  "data": {
    "articles": [
      {
        "id": 10452,
        "slug": "expressway-traffic-restored",
        "title": "Expressway Traffic Flow Restored",
        "excerpt": "Traffic flow restored on Expressway following clear lanes.",
        "content": "Full article body content...",
        "categorySlug": "news",
        "author": "Jane Doe",
        "authorDetails": {
          "id": 42,
          "name": "Jane Doe",
          "slug": "jane-doe",
          "bio": "Senior Business Reporter at Capital FM",
          "avatarUrl": "https://www.capitalfm.africa/wp-content/uploads/authors/jane.jpg",
          "archiveUrl": "https://www.capitalfm.africa/author/jane-doe/",
          "presenter": { "id": 15, "slug": "jane-doe", "name": "Jane Doe" }
        },
        "authors": [
          {
            "id": 42,
            "name": "Jane Doe",
            "slug": "jane-doe",
            "avatarUrl": "https://www.capitalfm.africa/wp-content/uploads/authors/jane.jpg",
            "archiveUrl": "https://www.capitalfm.africa/author/jane-doe/",
            "apiUrl": "https://capitalfm.africa/wp-json/capitalfm/v1/authors/42",
            "presenter": { "id": 15, "slug": "jane-doe", "name": "Jane Doe" }
          },
          {
            "id": 77,
            "name": "John Mwangi",
            "slug": "john-mwangi",
            "avatarUrl": "https://www.capitalfm.africa/wp-content/uploads/authors/john.jpg",
            "archiveUrl": "https://www.capitalfm.africa/author/john-mwangi/",
            "apiUrl": "https://capitalfm.africa/wp-json/capitalfm/v1/authors/77",
            "presenter": null
          }
        ],
        "coverImageUrl": "https://www.capitalfm.africa/wp-content/uploads/2026/08/traffic.jpg",
        "isVideo": true,
        "publishedAt": "2026-08-26T14:30:00.000Z",
        "publishedAtTimestamp": 1787754600000
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10
  }
}
```

> **Bylines:** a story can have more than one author. Render the byline from `authors[]` (main author first, then co-authors). `author` / `authorDetails` hold only the main author and stay for backward compatibility.

> **Video stories:** every article in a news listing (this feed, search, trending and author stories) carries `isVideo`: `true` when the story has a YouTube video. The listing payload is otherwise unchanged. To play the video, open the story: the single article (`GET /api/v1/news/:idOrSlug`) and the `/api/v1/videos` endpoints (section 1.5) also carry `video`, the story's YouTube video as the website sends it, or `null` when it has none:
>
> ```json
> "video": {
>   "provider": "youtube",
>   "id": "U9x-X1Un5sw",
>   "url": "https://youtu.be/U9x-X1Un5sw",
>   "watch_url": "https://www.youtube.com/watch?v=U9x-X1Un5sw",
>   "embed_url": "https://www.youtube.com/embed/U9x-X1Un5sw",
>   "thumbnail": {
>     "default": "https://i.ytimg.com/vi/U9x-X1Un5sw/hqdefault.jpg",
>     "medium": "https://i.ytimg.com/vi/U9x-X1Un5sw/mqdefault.jpg",
>     "max": "https://i.ytimg.com/vi/U9x-X1Un5sw/maxresdefault.jpg"
>   },
>   "is_short": false
> }
> ```
>
> Play `video.embed_url` in the app's YouTube player (or open `video.watch_url`), use a vertical layout when `video.is_short` is `true`, and use `coverImageUrl` as the card picture, falling back to `video.thumbnail.default`.
>
> **Detected videos:** the website fills `video` only when an editor pastes the link into the story's YouTube box. When that box is empty but the story body embeds a YouTube video (a YouTube player, a WordPress embed block, or a bare YouTube video link on its own line; not a link inside the text, and not a channel or playlist link), the gateway builds the same `video` object from the first such video in the body and adds `"source": "detected"`, so `isVideo` is `true` too. A video from the YouTube box always wins and has no `source` key. The body is only read when the full story is fetched, so a listing shows `isVideo: true` for such a story once the gateway has fetched it in full. Detected videos are not listed by `/api/v1/videos` (section 1.5), which carries only the website's videos.

### 1.3 Author Profile & Author Articles Page
- **Endpoint**: `GET /api/v1/news/author/:idOrSlug`
- **Query Params**: `page` (default: 1), `limit` (default: 10)
- Includes stories the author co-wrote (backed by the Capital FM `/authors/{id}/articles` API). New screens should prefer the `/api/v1/authors` endpoints in section 1.4, which also expose `total_pages`.
- **Response**:
```json
{
  "status": "success",
  "data": {
    "author": {
      "id": 42,
      "name": "Jane Doe",
      "slug": "jane-doe",
      "bio": "Senior Business Reporter at Capital FM",
      "avatarUrl": "https://www.capitalfm.africa/wp-content/uploads/authors/jane.jpg",
      "archiveUrl": "https://www.capitalfm.africa/author/jane-doe/",
      "presenter": { "id": 15, "slug": "jane-doe", "name": "Jane Doe" }
    },
    "articles": [
      {
        "id": 10452,
        "title": "Expressway Traffic Flow Restored",
        "slug": "expressway-traffic-restored",
        "publishedAt": "2026-08-26T14:30:00.000Z"
      }
    ],
    "total": 24,
    "page": 1,
    "limit": 10
  }
}
```

### 1.3 🔍 Global Multi-Category News & Podcast Search
- **Endpoint**: `GET /api/v1/search`
- **Query Params**:
  - `q` or `query` or `search` (required, full-text query term e.g. `nairobi`, `business`, `dj`)
  - `category` (optional, e.g. `all`, `sports`, `business`, `lifestyle`, `entertainment`, etc.)
  - `type` (optional, `all`, `news`, `podcasts`)
  - `page` (default: 1)
  - `limit` (default: 10)
- **Response**:
```json
{
  "status": "success",
  "data": {
    "query": "kenya",
    "totalResults": 15,
    "news": {
      "total": 10,
      "page": 1,
      "limit": 10,
      "articles": [
        {
          "id": 10452,
          "slug": "expressway-traffic-restored",
          "title": "Expressway Traffic Flow Restored",
          "excerpt": "Traffic flow restored on Expressway following clear lanes.",
          "categorySlug": "news",
          "publishedAt": "2026-08-26T14:30:00.000Z"
        }
      ]
    },
    "podcasts": {
      "total": 5,
      "page": 1,
      "limit": 10,
      "episodes": [
        {
          "guid": "ep-mix-01",
          "title": "Capital FM DJ Mix Master",
          "description": "Exclusive Weekend Mix Podcast",
          "audioUrl": "https://atunwadigital-rss.streamguys1.com/mix.mp3",
          "duration": "45:00",
          "publishedAt": "2026-08-26T10:00:00.000Z"
        }
      ]
    }
  }
}
```

### 1.4 ✍️ Authors Directory, Profiles & Stories
Every author with at least one published story (as main author **or** co-author). Author records are passed through from the Capital FM API unchanged; a field with no value is `null`, never absent. Only public fields are returned.

> **Website downtime:** authors, author stories and presenter profiles are served from the gateway's PostgreSQL store first (like `/api/v1/news`) and re-synced from capitalfm.africa in the background while the gateway is serving traffic (every 15 min for profiles, every 5 min for author stories). These screens keep working when the website is down. The live state in 4.3 is the exception: it is never served from storage, because a stale "live" flag would show the wrong button.

**List authors**
- **Endpoint**: `GET /api/v1/authors`
- **Query Params**: `search` (name or slug, partial), `orderby` (`stories` default, `name`, `recent`), `page` (default: 1), `per_page` (default: 20, max: 100; `limit` is accepted as an alias with the same cap)
- **Response**:
```json
{
  "status": "success",
  "data": [
    {
      "id": 13671,
      "name": "Jane Doe",
      "slug": "jane-doe",
      "image": "https://www.capitalfm.africa/wp-content/uploads/authors/jane.jpg",
      "story_count": 1840,
      "latest_story": "2026-11-05T09:12:00+03:00",
      "url": "https://capitalfm.africa/author/jane-doe/",
      "api_url": "https://capitalfm.africa/wp-json/capitalfm/v1/authors/13671",
      "articles_url": "https://capitalfm.africa/wp-json/capitalfm/v1/authors/13671/articles"
    }
  ],
  "meta": { "total": 120, "total_pages": 6, "page": 1, "per_page": 20 }
}
```

**Author profile**
- **Endpoint**: `GET /api/v1/authors/:idOrSlug`
- **Response**: the list fields plus `bio` (plain text), `website` (or `null`) and `presenter` (`{ id, slug, name, api_url }` when the author is also on air, else `null`). Returns `404` for an unknown author or one with no published story.

**Author's stories (co-written included)**
- **Endpoint**: `GET /api/v1/authors/:idOrSlug/articles`
- **Query Params**: `page` (default: 1), `per_page` (default: 10, max: 50; `limit` is accepted as an alias with the same cap), `fields` (`summary` default, or `full`)
- Newest first. Articles have the same shape as `/api/v1/news` (including `authors[]`), and `data.author` carries the full profile, so one call fills an author screen. Page with `meta.total_pages`.
- **Response**:
```json
{
  "status": "success",
  "data": {
    "author": { "id": 13671, "name": "Jane Doe", "slug": "jane-doe", "story_count": 1840, "bio": "…", "website": null, "presenter": null },
    "articles": [ { "id": 10452, "slug": "expressway-traffic-restored", "title": "Expressway Traffic Flow Restored", "authors": [ { "id": 13671, "name": "Jane Doe" } ] } ]
  },
  "meta": { "total": 1840, "total_pages": 184, "page": 1, "per_page": 10 }
}
```

### 1.5 🎬 Videos
Stories with a playable YouTube video (public or unlisted, embedding allowed), newest first. A video used on several stories appears **once**, under its newest story; the other stories are listed in `alsoIn`.

**List video stories**
- **Endpoint**: `GET /api/v1/videos`
- **Query Params**: `section` (category slug or ID, subcategories included, e.g. `news`, `business`), `search` (story title), `shorts` (`true` = Shorts only, `false` = no Shorts, omit for both), `fields` (`summary` default, or `full`), `page` (default: 1), `limit` (default: 10, max: 50; `per_page` is accepted as an alias with the same cap)
- Items have the same shape as `/api/v1/news` articles (with `video` and `isVideo: true`), plus `alsoIn`: `[{ id, slug, title, url, api_url }]` for the other stories that use the same video.
- **Response**:
```json
{
  "status": "success",
  "data": {
    "articles": [
      {
        "id": 1447865,
        "slug": "experts-kenya-needs-a-stable-tax-regime",
        "title": "Experts: Kenya needs a stable tax regime",
        "categorySlug": "news",
        "video": { "provider": "youtube", "id": "qWq0fP-6b-0", "watch_url": "https://www.youtube.com/watch?v=qWq0fP-6b-0", "embed_url": "https://www.youtube.com/embed/qWq0fP-6b-0", "thumbnail": { "default": "https://i.ytimg.com/vi/qWq0fP-6b-0/hqdefault.jpg" }, "is_short": false },
        "isVideo": true,
        "alsoIn": [
          { "id": 1447846, "slug": "kenya-must-curb-public-spending", "title": "Kenya must curb public spending", "url": "https://capitalfm.africa/kenya-must-curb-public-spending/", "api_url": "https://capitalfm.africa/wp-json/capitalfm/v1/articles/kenya-must-curb-public-spending" }
        ],
        "publishedAt": "2026-11-01T08:00:00.000Z"
      }
    ],
    "total": 9,
    "page": 1,
    "limit": 10
  }
}
```

**One video story**
- **Endpoint**: `GET /api/v1/videos/:idOrSlug` — accepts the YouTube video ID (e.g. `U9x-X1Un5sw`), the story ID or the story slug.
- **Response**: `{ "status": "success", "data": { …article with full content, video, isVideo, alsoIn } }`. Returns `404` when there is no published story with a playable video for that ID or slug.

> **Website downtime:** the videos are hosted on YouTube, not on the website, so the app can still play them while capitalfm.africa is down. Every story the gateway fetches is stored with its video. A single video story is answered from that store first and re-synced in the background every 5 minutes. The list is answered by the website (cached 5 minutes) and falls back to the stored video stories when the website is down. That offline list can differ from the website's: `section` matches a story's primary section slug only (no subcategories, no numeric IDs), and grouping into one entry per video (with `alsoIn`) and `total` cover only the newest 500 stored video stories, so a story the gateway has never fetched is missing.

---

## 2. 🎙️ Podcasts & Audio Playback

- **Endpoint**: `GET /api/v1/podcasts`
- **Query Params**: `page` (default: 1), `limit` (default: 10)
- **Response**:
```json
{
  "status": "success",
  "data": {
    "channel": {
      "title": "Capital FM Podcast Network",
      "description": "Premium audio shows and interviews",
      "coverImageUrl": "https://www.capitalfm.africa/podcasts/cover.jpg"
    },
    "episodes": [
      {
        "id": "financial-fitness-ep42",
        "title": "The Financial Fitness Masterclass Ep 42",
        "description": "Expert advice on personal wealth management.",
        "audioUrl": "https://stream.capitalfm.africa/podcasts/ep42.mp3",
        "duration": "45:30",
        "pubDate": "2026-08-25T10:00:00.000Z"
      }
    ],
    "total": 24,
    "page": 1,
    "limit": 10
  }
}
```

---

## 3. 📻 Radio Shows & Presenter Schedules

- **Endpoint**: `GET /api/v1/schedules`
- **Query Params**: `day` (optional e.g. `monday`, `tuesday`)
- **Response**:
```json
{
  "status": "success",
  "data": {
    "day": "monday",
    "shows": [
      {
        "id": "jam-984-mon",
        "title": "The Jam 98.4",
        "hosts": ["Martin Kariuki", "Miss Mandi"],
        "startTime": "15:00",
        "endTime": "19:00",
        "bannerImageUrl": "https://www.capitalfm.africa/shows/jam984.jpg",
        "isLiveNow": true
      }
    ]
  }
}
```

### 3.1 🎤 Presenters & Full Presenter Profile
- **List**: `GET /api/v1/presenters` — Query Params: `search`, `fields` (`summary` or `full`), `page`, `per_page`
- **Full profile**: `GET /api/v1/presenters/:slug` (a numeric ID also works)
  - Returns the complete Capital FM presenter record: name, role, tagline, image, `bio.html` / `bio.text`, social links, public email, `shows[]` with the slots each show airs in, and `articles[]` when the presenter is linked to a WordPress author.
  - Empty fields are `null` (profiles are only as complete as wp-admin). Returns `404` for an unknown presenter.
  - An author's `presenter.slug` (section 1.4) and a schedule slot's `presenterRecords[].slug` both open this endpoint.

---

## 4. 🎧 Live Stream Audio & Realtime Now Playing Track

### 4.1 Stream Configuration Endpoint
- **Endpoint**: `GET /api/v1/stream/config`
- **Response**:
```json
{
  "status": "success",
  "data": {
    "primaryHlsUrl": "https://stream.capitalfm.africa/live/128k.m3u8",
    "fallbackAacUrl": "https://stream.capitalfm.africa/live/64k.aac",
    "icyStreamUrl": "http://stream.capitalfm.africa:8000/capitalfm.mp3",
    "bitrateKbps": 128
  }
}
```

### 4.2 Realtime Currently Playing Track
- **Endpoint**: `GET /api/v1/stream/nowplaying`
- **Response**:
```json
{
  "status": "success",
  "data": {
    "trackTitle": "Espresso",
    "artist": "Sabrina Carpenter",
    "showName": "The Jam 98.4",
    "albumArtUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/600x600bb.jpg"
  }
}
```

### 4.3 📺 Live State & Watch-Live (YouTube) Button
- **Endpoint**: `GET /api/v1/live` (alias: `GET /api/v1/schedules/live`). The same block is also included as `data.live` on `GET /api/v1/stream/nowplaying`.
- **Poll every ~60 seconds** while the player or home screen is visible. The gateway caches this for 30 seconds (the Capital FM upstream TTL), so polling stays cheap and the button never lags more than about a minute.
- **Response**:
```json
{
  "status": "success",
  "data": {
    "radio": {
      "is_live": true,
      "stream_url": "https://atunwadigital.streamguys1.com/capitalfm",
      "show": "The Hype",
      "host": "Adnan, K Deja, Nikky",
      "ends_at": "2026-09-22T22:00:00+03:00"
    },
    "youtube": {
      "is_live": true,
      "video_id": null,
      "channel_id": "UCsURxs8Kz_qzezpicj-STyw",
      "title": null,
      "watch_url": "https://www.youtube.com/channel/UCsURxs8Kz_qzezpicj-STyw/live",
      "embed_url": "https://www.youtube.com/embed/live_stream?channel=UCsURxs8Kz_qzezpicj-STyw"
    },
    "checked_at": "2026-09-22T20:04:42+03:00"
  },
  "meta": { "timezone": "Africa/Nairobi", "generated_at": "2026-09-22T20:04:42+03:00", "api_version": "2.4.0" }
}
```
- **Live-button rule:**
  - Show the **Watch live** button only when `data.youtube.is_live === true`; hide it otherwise.
  - On tap, open `data.youtube.watch_url` (or play `embed_url` in-app).
  - **Never** gate the button on `video_id`: it is legitimately `null` while live on a channel stream.
  - Compute nothing from the device clock; the server decides what is live.
  - All `youtube` keys are always present (`null` when unset). If the gateway cannot reach Capital FM, it returns `youtube.is_live: false`, so the button hides rather than sticking on.

---

## 5. 🔔 Push Notification Registration (FCM)

Register the device FCM token to receive breaking news and show notifications.

- **Endpoint**: `POST /api/v1/notifications/register`
- **Request**:
```json
{
  "token": "dKxY8_z90x...fcm_token",
  "topics": [
    "breaking_news",
    "podcast_episodes",
    "show_jam-984-mon"
  ],
  "action": "subscribe"
}
```
- **Response**:
```json
{
  "status": "success",
  "message": "Device token subscribed to 3 topics successfully."
}
```

---

## 6. 👤 User Profile & Favorites Sync

### 6.1 Register / Login Profile
- **Endpoint**: `POST /api/v1/user/profile`
- **Request**:
```json
{
  "email": "user@capitalfm.co.ke",
  "username": "JaneDoe"
}
```

### 6.2 Profile & Data Deletion Flow (Email Verification Required)
- **Direct Delete Endpoint (Disabled)**: `DELETE /api/v1/user/profile` (Returns HTTP 403 Forbidden - Direct deletion is disabled)
- **Account Deletion Workflow**:
  1. **Request Deletion Token**: `POST /api/v1/user/request-deletion` (Body: `{ "email": "user@capitalfm.co.ke" }`)
  2. **Send Deep Link to Email**: `POST /api/v1/user/send-deletion-link` (Body: `{ "email": "...", "deletionToken": "...", "deletionLink": "..." }`)
  3. **Confirm & Purge Account Data**: `POST /api/v1/user/confirm-deletion` (Body: `{ "email": "...", "deletionToken": "..." }`)
- **Web Account Deletion Portal**: `https://api.capitalfm.africa/delete-account` (or `/account-deletion`)

### 6.3 Save Favorite Item
- **Endpoint**: `POST /api/v1/user/favorites`
- **Headers**: `X-User-Email: user@capitalfm.co.ke`
- **Request**:
```json
{
  "itemType": "article",
  "itemId": "10452",
  "metadata": {
    "title": "Expressway Traffic Restored",
    "coverImageUrl": "https://www.capitalfm.africa/wp-content/uploads/2026/08/traffic.jpg"
  }
}
```


---

## 💙 Flutter / Dart Client Code (`CapitalApiClient.dart`)

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class CapitalApiClient {
  static const String baseUrl = 'https://ca-capital-backend-api.southafricanorth.azurecontainerapps.io';

  /// Fetch News Categories
  Future<List<dynamic>> fetchCategories() async {
    final response = await http.get(Uri.parse('$baseUrl/api/v1/news/categories'));
    if (response.statusCode == 200) {
      final json = jsonDecode(response.body);
      return json['data']['categories'];
    }
    throw Exception('Failed to load categories');
  }

  /// Fetch Articles Feed with optional category and search
  Future<List<dynamic>> fetchArticles({String category = 'all', int page = 1, String? search}) async {
    var url = '$baseUrl/api/v1/news?category=$category&page=$page&limit=10';
    if (search != null && search.isNotEmpty) {
      url += '&search=${Uri.encodeComponent(search)}';
    }
    final response = await http.get(Uri.parse(url));
    if (response.statusCode == 200) {
      final json = jsonDecode(response.body);
      return json['data']['articles'];
    }
    throw Exception('Failed to load articles');
  }

  /// Fetch an author's stories (co-written included) plus their profile in `author`
  Future<Map<String, dynamic>> fetchAuthorArticles(String idOrSlug, {int page = 1}) async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/v1/authors/${Uri.encodeComponent(idOrSlug)}/articles?page=$page&per_page=10'),
    );
    if (response.statusCode == 200) {
      final json = jsonDecode(response.body);
      return {'author': json['data']['author'], 'articles': json['data']['articles'], 'meta': json['meta']};
    }
    throw Exception('Failed to load author articles');
  }

  /// Fetch a presenter's full profile by slug
  Future<Map<String, dynamic>> fetchPresenter(String slug) async {
    final response = await http.get(Uri.parse('$baseUrl/api/v1/presenters/${Uri.encodeComponent(slug)}'));
    if (response.statusCode == 200) {
      return jsonDecode(response.body)['data'];
    }
    throw Exception('Failed to load presenter');
  }

  /// Poll live state about every 60 seconds (e.g. with Timer.periodic).
  /// Show the Watch-live button only when youtube['is_live'] == true, and open youtube['watch_url'].
  Future<Map<String, dynamic>> fetchLiveState() async {
    final response = await http.get(Uri.parse('$baseUrl/api/v1/live'));
    if (response.statusCode == 200) {
      return jsonDecode(response.body)['data'];
    }
    throw Exception('Failed to load live state');
  }

  /// Register FCM Device Token for Push Notifications
  Future<bool> registerFcmToken(String fcmToken, List<String> topics) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/v1/notifications/register'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'token': fcmToken,
        'topics': topics,
        'action': 'subscribe',
      }),
    );
    return response.statusCode == 200;
  }
}
```
