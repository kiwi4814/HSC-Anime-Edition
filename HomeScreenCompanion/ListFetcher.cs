using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Common.Net;
using HttpRequestOptions = MediaBrowser.Common.Net.HttpRequestOptions;
using MediaBrowser.Model.Serialization;

namespace HomeScreenCompanion
{

    public class ListFetcher
    {
        private readonly IHttpClient _httpClient;
        private readonly IJsonSerializer _jsonSerializer;


        public ListFetcher(IHttpClient httpClient, IJsonSerializer jsonSerializer)
        {
            _httpClient = httpClient;
            _jsonSerializer = jsonSerializer;
        }

        public async Task<List<ExternalItemDto>> FetchItems(string url, int limit, string traktClientId, string mdbApiKey, string tmdbApiKey, CancellationToken cancellationToken)
        {
            // Set a global maximum of 1000 items to prevent massive fetches, unless a specific smaller limit is requested
            if (limit <= 0 || limit > 1000)
            {
                limit = 1000;
            }

            if (string.IsNullOrWhiteSpace(url)) return new List<ExternalItemDto>();

            if (url.Contains("mdblist.com"))
            {
                return await FetchMdblist(url, mdbApiKey, limit, cancellationToken);
            }
            else if (url.Contains("themoviedb.org"))
            {
                return await FetchTmdb(url, tmdbApiKey, limit, cancellationToken);
            }
            else
            {
                return await FetchTrakt(url, traktClientId, limit, cancellationToken);
            }
        }

        private async Task<List<ExternalItemDto>> FetchMdblist(string listUrl, string apiKey, int limit, CancellationToken cancellationToken)
        {
            if (IsMdblistOfficialList(listUrl) || string.IsNullOrWhiteSpace(apiKey))
                return await FetchMdblistLegacy(listUrl, limit, cancellationToken);
            else
                return await FetchMdblistApi(listUrl, apiKey, limit, cancellationToken);
        }

        // Official lists (mdblist.com/lists/official/...) have no api.mdblist.com endpoint, only the public /json one
        private static bool IsMdblistOfficialList(string url) =>
            url.IndexOf("/lists/official/", StringComparison.OrdinalIgnoreCase) >= 0;

        // Uses api.mdblist.com — works for both public and private lists
        private async Task<List<ExternalItemDto>> FetchMdblistApi(string listUrl, string apiKey, int limit, CancellationToken cancellationToken)
        {
            var apiBaseUrl = BuildMdblistApiUrl(listUrl);
            const int pageSize = 1000;
            var all = new List<ExternalItemDto>();
            int offset = 0;

            while (true)
            {
                var apiUrl = $"{apiBaseUrl}?apikey={apiKey}&limit={pageSize}&offset={offset}";
                try
                {
                    using (var stream = await _httpClient.Get(new HttpRequestOptions { Url = apiUrl, CancellationToken = cancellationToken }))
                    {
                        var result = _jsonSerializer.DeserializeFromStream<MdbListResponse>(stream);
                        if (result == null) break;

                        var movies = result.movies ?? new List<MdbListItem>();
                        var shows = result.shows ?? new List<MdbListItem>();
                        int pageCount = movies.Count + shows.Count;
                        if (pageCount == 0) break;

                        var page = movies.Concat(shows)
                            .Where(x => !string.IsNullOrEmpty(x.imdb_id))
                            .Select(x => new ExternalItemDto { Name = x.title, Imdb = x.imdb_id, Tmdb = null });
                        all.AddRange(page);

                        if (pageCount < pageSize) break;
                        if (limit < 10000 && all.Count >= limit) break;
                        offset += pageSize;
                    }
                }
                catch { break; }
            }

            return all;
        }

        // Legacy fallback: mdblist.com/slug/json — public lists only, no API key needed
        private async Task<List<ExternalItemDto>> FetchMdblistLegacy(string listUrl, int limit, CancellationToken cancellationToken)
        {
            var cleanUrl = listUrl.Trim();
            int queryIndex = cleanUrl.IndexOfAny(new[] { '?', '#' });
            if (queryIndex >= 0) cleanUrl = cleanUrl.Substring(0, queryIndex);
            cleanUrl = cleanUrl.TrimEnd('/');
            if (!cleanUrl.EndsWith("/json")) cleanUrl += "/json";

            const int pageSize = 1000;
            var all = new List<ExternalItemDto>();
            int offset = 0;

            while (true)
            {
                var apiUrl = $"{cleanUrl}?limit={pageSize}&offset={offset}&_={DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";
                try
                {
                    using (var stream = await _httpClient.Get(new HttpRequestOptions { Url = apiUrl, CancellationToken = cancellationToken }))
                    {
                        var result = _jsonSerializer.DeserializeFromStream<List<MdbListItem>>(stream);
                        if (result == null || result.Count == 0) break;

                        var page = result
                            .Where(x => !string.IsNullOrEmpty(x.imdb_id))
                            .Select(x => new ExternalItemDto { Name = x.title, Imdb = x.imdb_id, Tmdb = null });
                        all.AddRange(page);

                        if (result.Count < pageSize) break;
                        if (limit < 10000 && all.Count >= limit) break;
                        offset += pageSize;
                    }
                }
                catch { break; }
            }

            return all;
        }

        private static string BuildMdblistApiUrl(string listUrl)
        {
            var cleaned = listUrl.Trim().TrimEnd('/');

            // Already a correct API items URL
            if (cleaned.Contains("api.mdblist.com") && cleaned.EndsWith("/items"))
                return cleaned;

            if (Uri.TryCreate(cleaned, UriKind.Absolute, out var uri))
            {
                var path = uri.AbsolutePath.TrimEnd('/');
                if (path.EndsWith("/json")) path = path.Substring(0, path.Length - 5);
                if (path.EndsWith("/items")) path = path.Substring(0, path.Length - 6);
                return $"https://api.mdblist.com{path}/items";
            }

            // Fallback: treat as path fragment
            var fallback = cleaned
                .Replace("https://mdblist.com", "")
                .Replace("https://www.mdblist.com", "")
                .TrimEnd('/');
            if (fallback.EndsWith("/json")) fallback = fallback.Substring(0, fallback.Length - 5);
            return $"https://api.mdblist.com{fallback}/items";
        }

        private class TmdbApiTarget
        {
            public string ListId { get; set; }
            public string Endpoint { get; set; }
            public string MediaType { get; set; }
            public string FullUrl { get; set; }
        }

        private TmdbApiTarget ExtractTmdbApiTarget(string url)
        {
            try
            {
                var uri = new Uri(url);

                if (uri.Host.Equals("api.themoviedb.org", StringComparison.OrdinalIgnoreCase))
                {
                    string mediaType = null;
                    if (uri.AbsolutePath.Contains("/movie/")) mediaType = "movie";
                    else if (uri.AbsolutePath.Contains("/tv/")) mediaType = "tv";
                    return new TmdbApiTarget { FullUrl = url, MediaType = mediaType };
                }

                var segments = uri.Segments.Select(s => s.TrimEnd('/')).Where(s => !string.IsNullOrEmpty(s)).ToList();

                if (segments.Count >= 2 && segments[0] == "list")
                {
                    return new TmdbApiTarget { ListId = segments[1] };
                }

                if (segments.Count >= 1 && (segments[0] == "movie" || segments[0] == "tv"))
                {
                    string type = segments[0];
                    string category = segments.Count > 1 ? segments[1].Replace("-", "_") : "popular";

                    var validCategories = new[] { "popular", "top_rated", "now_playing", "upcoming", "on_the_air", "airing_today" };
                    if (validCategories.Contains(category))
                    {
                        return new TmdbApiTarget { Endpoint = $"{type}/{category}", MediaType = type };
                    }
                }
            }
            catch { }
            return null;
        }

        private async Task<List<ExternalItemDto>> FetchTmdb(string url, string apiKey, int limit, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(apiKey)) return new List<ExternalItemDto>();

            var target = ExtractTmdbApiTarget(url);
            if (target == null) return new List<ExternalItemDto>();

            var all = new List<ExternalItemDto>();
            int page = 1;
            bool isToken = apiKey.Length > 100 || apiKey.Contains(".");
            bool useV4 = !string.IsNullOrEmpty(target.ListId);
            bool useV3 = true;

            while (true)
            {
                TmdbListResponse result = null;

                if (useV4 && !string.IsNullOrEmpty(target.ListId))
                {
                    var apiUrl = $"https://api.themoviedb.org/4/list/{target.ListId}?page={page}";
                    if (!isToken) apiUrl += $"&api_key={apiKey}";

                    try
                    {
                        var options = new HttpRequestOptions { Url = apiUrl, CancellationToken = cancellationToken };
                        if (isToken)
                        {
                            options.RequestHeaders.Add("Authorization", $"Bearer {apiKey}");
                        }
                        using (var stream = await _httpClient.Get(options))
                        {
                            result = _jsonSerializer.DeserializeFromStream<TmdbListResponse>(stream);
                            useV3 = false;
                        }
                    }
                    catch
                    {
                        useV4 = false;
                    }
                }

                if (useV3 && result == null)
                {
                    string apiUrl;
                    if (!string.IsNullOrEmpty(target.FullUrl))
                    {
                        apiUrl = target.FullUrl;
                        apiUrl += apiUrl.Contains("?") ? $"&page={page}" : $"?page={page}";
                    }
                    else
                    {
                        apiUrl = string.IsNullOrEmpty(target.Endpoint) 
                            ? $"https://api.themoviedb.org/3/list/{target.ListId}?page={page}"
                            : $"https://api.themoviedb.org/3/{target.Endpoint}?page={page}";
                    }
                        
                    if (!isToken) apiUrl += $"&api_key={apiKey}";

                    try
                    {
                        var options = new HttpRequestOptions { Url = apiUrl, CancellationToken = cancellationToken };
                        if (isToken)
                        {
                            options.RequestHeaders.Add("Authorization", $"Bearer {apiKey}");
                        }
                        using (var stream = await _httpClient.Get(options))
                        {
                            result = _jsonSerializer.DeserializeFromStream<TmdbListResponse>(stream);
                        }
                    }
                    catch
                    {
                        break;
                    }
                }

                if (result == null) break;

                var items = (result.items != null && result.items.Count > 0) ? result.items : result.results;
                if (items == null || items.Count == 0) break;

                foreach (var item in items)
                {
                    var dto = new ExternalItemDto
                    {
                        Name = item.title ?? item.name,
                        Tmdb = item.id.ToString()
                    };

                    try
                    {
                        var type = target.MediaType ?? (item.media_type == "tv" ? "tv" : "movie");
                        var extUrl = $"https://api.themoviedb.org/3/{type}/{item.id}/external_ids";
                        if (!isToken) extUrl += $"?api_key={apiKey}";
                        
                        var extOptions = new HttpRequestOptions { Url = extUrl, CancellationToken = cancellationToken };
                        if (isToken)
                        {
                            extOptions.RequestHeaders.Add("Authorization", $"Bearer {apiKey}");
                        }

                        using (var extStream = await _httpClient.Get(extOptions))
                        {
                            var extIds = _jsonSerializer.DeserializeFromStream<TmdbExternalIds>(extStream);
                            if (extIds != null && !string.IsNullOrEmpty(extIds.imdb_id))
                            {
                                dto.Imdb = extIds.imdb_id;
                            }
                        }
                    }
                    catch { }

                    all.Add(dto);
                    if (limit > 0 && all.Count >= limit) return all.Take(limit).ToList();
                }

                if (page >= result.total_pages) break;
                page++;
            }

            return all;
        }

        private async Task<List<ExternalItemDto>> FetchTrakt(string rawUrl, string clientId, int limit, CancellationToken cancellationToken)
        {
            string path = rawUrl.Trim();

            if (Uri.TryCreate(path, UriKind.Absolute, out var uri))
            {
                path = uri.AbsolutePath;
            }
            else
            {
                path = path.Replace("https://trakt.tv", "")
                           .Replace("https://api.trakt.tv", "")
                           .Replace("https://app.trakt.tv", "")
                           .Trim();
            }

            if (path.Contains("?")) path = path.Split('?')[0];
            path = path.Trim();

            if (path.Contains("/users/") && path.Contains("/lists/") && !path.EndsWith("/items"))
            {
                path = path.TrimEnd('/') + "/items";
            }

            if (!path.StartsWith("/")) path = "/" + path;

            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var options = new HttpRequestOptions { Url = $"https://api.trakt.tv{path}?limit={limit}&_={timestamp}", CancellationToken = cancellationToken };

            options.RequestHeaders.Add("trakt-api-version", "2");
            options.RequestHeaders.Add("trakt-api-key", clientId);
            options.UserAgent = "HomeScreenCompanionPlugin/1.0";
            options.RequestHeaders.Add("Accept", "application/json");

            return await FetchTraktRobust(options);
        }

        private async Task<List<ExternalItemDto>> FetchTraktRobust(MediaBrowser.Common.Net.HttpRequestOptions options)
        {
            try
            {
                using (var stream = await _httpClient.Get(options))
                using (var reader = new StreamReader(stream))
                {
                    string json = await reader.ReadToEndAsync();
                    var list = new List<ExternalItemDto>();

                    try
                    {
                        var wrappedList = _jsonSerializer.DeserializeFromString<List<TraktBaseObject>>(json);
                        if (wrappedList != null && wrappedList.Any(x => x.movie != null || x.show != null))
                        {
                            foreach (var item in wrappedList)
                            {
                                string? title = item.movie?.title ?? item.show?.title;
                                string? imdb = item.movie?.ids?.imdb ?? item.show?.ids?.imdb;

                                if (!string.IsNullOrEmpty(title) && !string.IsNullOrEmpty(imdb))
                                    list.Add(new ExternalItemDto { Name = title, Imdb = imdb, Tmdb = null });
                            }
                            if (list.Count > 0) return list;
                        }
                    }
                    catch { }

                    try
                    {
                        var flatList = _jsonSerializer.DeserializeFromString<List<TraktMovie>>(json);
                        if (flatList != null)
                        {
                            foreach (var item in flatList)
                            {
                                if (!string.IsNullOrEmpty(item.title) && !string.IsNullOrEmpty(item.ids?.imdb))
                                    list.Add(new ExternalItemDto { Name = item.title, Imdb = item.ids?.imdb, Tmdb = null });
                            }
                            if (list.Count > 0) return list;
                        }
                    }
                    catch { }

                    return list;
                }
            }
            catch { return new List<ExternalItemDto>(); }
        }

        public async Task<List<AiListItem>> FetchAiList(
            string provider,
            string prompt,
            string openAiApiKey,
            string openAiModel,
            string geminiApiKey,
            string geminiModel,
            string claudeApiKey,
            string claudeModel,
            string ollamaBaseUrl,
            string ollamaModel,
            string systemPrompt,
            string recentlyWatchedContext,
            int limit,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(prompt))
                return new List<AiListItem>();

            var userMessage = string.IsNullOrWhiteSpace(recentlyWatchedContext)
                ? $"{prompt}\n\nReturn up to {limit} items."
                : $"{recentlyWatchedContext}\n\n{prompt}\n\nReturn up to {limit} items.";

            try
            {
                var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
                // Preserve explicit per-list official provider selections.
                var requestConfig = new PluginConfiguration
                {
                    CompatibleAiBaseUrl = config.CompatibleAiBaseUrl,
                    CompatibleAiModel = config.CompatibleAiModel,
                    CompatibleAiApiKey = config.CompatibleAiApiKey,
                    OpenAiApiKey = openAiApiKey, OpenAiModel = openAiModel,
                    GeminiApiKey = geminiApiKey, GeminiModel = geminiModel,
                    ClaudeApiKey = claudeApiKey, ClaudeModel = claudeModel,
                    OllamaBaseUrl = ollamaBaseUrl, OllamaModel = ollamaModel
                };
                string rawJson = await new AiRequestClient(_jsonSerializer).CompleteAsync(requestConfig,
                    provider, systemPrompt, userMessage, Math.Max(1, config.AnimeAiMaxTokensPerCall), cancellationToken);

                var cleaned = AiRequestClient.CleanAiJsonOutput(rawJson);
                var items = _jsonSerializer.DeserializeFromString<List<AiListItem>>(cleaned);
                return items ?? new List<AiListItem>();
            }
            catch (OperationCanceledException) { throw; }
            catch
            {
                return new List<AiListItem>();
            }
        }


    }
}