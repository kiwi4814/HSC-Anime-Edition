using MediaBrowser.Model.Serialization;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace HomeScreenCompanion
{
    internal sealed class AniListGraphResponse
    {
        public AniListData data { get; set; } = new AniListData();
        public List<AniListError> errors { get; set; } = new List<AniListError>();
    }
    internal sealed class AniListError { public string message { get; set; } = ""; }
    internal sealed class AniListData { public AniListMedia? Media { get; set; } }
    internal sealed class AniListMedia
    {
        public int id { get; set; }
        public AniListTitle title { get; set; } = new AniListTitle();
        public AniListRelations relations { get; set; } = new AniListRelations();
    }
    internal sealed class AniListTitle
    {
        public string? native { get; set; }
        public string? romaji { get; set; }
        public string? english { get; set; }
        public string Best => english ?? romaji ?? native ?? "";
    }
    internal sealed class AniListRelations { public List<AniListEdge> edges { get; set; } = new List<AniListEdge>(); }
    internal sealed class AniListEdge
    {
        public string relationType { get; set; } = "";
        public AniListRelatedMedia node { get; set; } = new AniListRelatedMedia();
    }
    internal sealed class AniListRelatedMedia
    {
        public int id { get; set; }
        public string type { get; set; } = "";
        public AniListTitle title { get; set; } = new AniListTitle();
    }

    internal sealed class AnimeRelationCache
    {
        public List<AnimeRelationRecord> Entries { get; set; } = new List<AnimeRelationRecord>();
    }

    internal sealed class AnimeAniListClient
    {
        private const string Endpoint = "https://graphql.anilist.co";
        private const string Query = "query ($id: Int) { Media(id: $id, type: ANIME) { id title { native romaji english } relations { edges { relationType node { id type title { native romaji english } } } } } }";
        private static readonly HttpClient Client = new HttpClient();
        private static readonly int[] RetryDelaysMs = { 5000, 15000, 45000 };
        private readonly IJsonSerializer _json;
        private readonly string _cacheFile;
        private readonly Dictionary<int, AnimeRelationRecord> _cache = new Dictionary<int, AnimeRelationRecord>();

        public AnimeAniListClient(IJsonSerializer json, string dataDirectory)
        {
            _json = json;
            _cacheFile = Path.Combine(dataDirectory, "anime-anilist-relations.json");
            if (File.Exists(_cacheFile))
            {
                try
                {
                    var previous = json.DeserializeFromFile<AnimeRelationCache>(_cacheFile);
                    foreach (var e in previous?.Entries ?? new List<AnimeRelationRecord>())
                        if (e.Id > 0) _cache[e.Id] = e;
                }
                catch { /* Old/partial cache is rebuilt without mutating Emby. */ }
            }
        }

        public Task<AnimeGraphResult> ExpandAsync(IEnumerable<int> seeds, int requestBudget,
            int graphNodeLimit, int cacheDays, bool includeSpinOffs,
            CancellationToken cancellationToken, Action<string> onProgress) =>
            AnimeGraphExpansion.ExpandAsync(seeds, requestBudget, graphNodeLimit, cacheDays,
                includeSpinOffs, _cache, FetchAsync, Save, cancellationToken, onProgress);

        private async Task<AnimeRelationRecord> FetchAsync(int id, CancellationToken token)
        {
            string payload = _json.SerializeToString(new { query = Query, variables = new { id } });
            Exception? lastError = null;
            for (int attempt = 0; attempt < RetryDelaysMs.Length; attempt++)
            {
                token.ThrowIfCancellationRequested();
                try
                {
                    return await SendOnceAsync(id, payload, token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested)
                {
                    throw;
                }
                catch (OperationCanceledException ex)
                {
                    lastError = ex;
                    if (attempt == RetryDelaysMs.Length - 1) break;
                    await DelayBeforeRetry(attempt, null, token).ConfigureAwait(false);
                }
                catch (AniListTransientException ex)
                {
                    lastError = ex;
                    if (attempt == RetryDelaysMs.Length - 1) break;
                    await DelayBeforeRetry(attempt, ex.RetryAfterSeconds, token).ConfigureAwait(false);
                }
            }
            if (lastError is AniListTransientException transient && transient.StatusCode == 429)
                throw new InvalidDataException("AniList 请求受限（429），请稍后再次运行。已获取的缓存会保留。");
            if (lastError is AniListTransientException server)
                throw new InvalidDataException("AniList 暂时不可用（HTTP " + server.StatusCode + "），请稍后再次运行。已获取的缓存会保留。");
            if (lastError is OperationCanceledException)
                throw new InvalidDataException("AniList 请求超时，请稍后再次运行。已获取的缓存会保留。");
            throw lastError ?? new InvalidDataException("无法连接 AniList，请检查网络后再次运行。");
        }

        private async Task<AnimeRelationRecord> SendOnceAsync(int id, string payload, CancellationToken token)
        {
            using (var req = new HttpRequestMessage(HttpMethod.Post, Endpoint))
            using (var cts = CancellationTokenSource.CreateLinkedTokenSource(token))
            {
                cts.CancelAfter(TimeSpan.FromSeconds(35));
                req.Content = new StringContent(payload, Encoding.UTF8, "application/json");
                using (var response = await Client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token).ConfigureAwait(false))
                {
                    int status = (int)response.StatusCode;
                    // Never treat 429/5xx as an empty relationship graph; this must prevent writes.
                    if (status == 429 || status >= 500)
                    {
                        int? retryAfter = null;
                        if (response.Headers.RetryAfter?.Delta != null)
                            retryAfter = (int)Math.Ceiling(response.Headers.RetryAfter.Delta.Value.TotalSeconds);
                        else if (response.Headers.RetryAfter?.Date != null)
                        {
                            var wait = response.Headers.RetryAfter.Date.Value - DateTimeOffset.UtcNow;
                            if (wait.TotalSeconds > 0) retryAfter = (int)Math.Ceiling(wait.TotalSeconds);
                        }
                        throw new AniListTransientException(status, retryAfter);
                    }
                    if (status >= 400)
                        throw new InvalidDataException("AniList 返回错误状态（HTTP " + status + "），请检查网络或稍后重试。");
                    var jsonText = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    if (jsonText.Length > 2_000_000) throw new InvalidDataException("AniList 响应过大。");
                    var data = _json.DeserializeFromString<AniListGraphResponse>(jsonText);
                    if (data == null || data.data?.Media == null || data.errors?.Count > 0)
                        throw new InvalidDataException("AniList 未返回作品，或报告了 GraphQL 错误。");
                    var media = data.data.Media;
                    if (media.id != id) throw new InvalidDataException("AniList 返回的作品 ID 与请求不符。");
                    return new AnimeRelationRecord
                    {
                        Id = id,
                        FetchedUtc = DateTime.UtcNow,
                        Name = media.title?.Best ?? "",
                        Relations = (media.relations?.edges ?? new List<AniListEdge>())
                            .Where(e => e.node != null && e.node.id > 0)
                            .Select(e => new AnimeRelation
                            {
                                Id = e.node.id,
                                Type = e.node.type,
                                Relation = e.relationType,
                                Name = e.node.title?.Best ?? ""
                            }).ToList()
                    };
                }
            }
        }

        private static async Task DelayBeforeRetry(int attempt, int? retryAfterSeconds, CancellationToken token)
        {
            int ms = RetryDelaysMs[attempt];
            if (retryAfterSeconds.HasValue)
                ms = Math.Max(ms, Math.Min(120, Math.Max(1, retryAfterSeconds.Value)) * 1000);
            await Task.Delay(ms, token).ConfigureAwait(false);
        }

        private void Save()
        {
            var dir = Path.GetDirectoryName(_cacheFile);
            if (dir != null) Directory.CreateDirectory(dir);
            var text = _json.SerializeToString(new AnimeRelationCache { Entries = _cache.Values.ToList() });
            var tmp = _cacheFile + ".tmp";
            File.WriteAllText(tmp, text, Encoding.UTF8);
            if (File.Exists(_cacheFile)) File.Replace(tmp, _cacheFile, null);
            else File.Move(tmp, _cacheFile);
        }

        private sealed class AniListTransientException : Exception
        {
            public int StatusCode { get; }
            public int? RetryAfterSeconds { get; }
            public AniListTransientException(int statusCode, int? retryAfterSeconds)
                : base("AniList HTTP " + statusCode)
            {
                StatusCode = statusCode;
                RetryAfterSeconds = retryAfterSeconds;
            }
        }
    }
}
