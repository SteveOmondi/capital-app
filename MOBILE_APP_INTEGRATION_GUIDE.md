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
        "author": "Capital Digital",
        "coverImageUrl": "https://www.capitalfm.africa/wp-content/uploads/2026/08/traffic.jpg",
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

### 6.2 Save Favorite Item
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
