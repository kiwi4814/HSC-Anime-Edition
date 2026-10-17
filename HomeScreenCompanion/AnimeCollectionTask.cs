using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Collections;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Querying;
using MediaBrowser.Model.Serialization;
using MediaBrowser.Model.Tasks;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace HomeScreenCompanion
{
    public sealed class AnimeManagedCollection
    {
        public long CollectionId { get; set; }
        public int Anchor { get; set; }
        public string Name { get; set; } = "";
        public List<long> ManagedItemIds { get; set; } = new List<long>();
    }
    public sealed class AnimeCollectionState
    {
        public List<AnimeManagedCollection> Collections { get; set; } = new List<AnimeManagedCollection>();
    }

    /// <summary>
    /// Opt-in, independent task. Does not change HSC's normal tag/collection groups.
    /// Runs only after the entire finite AniList graph was resolved; uncertain / failed
    /// datasets can never trigger removal from Emby.
    /// </summary>
    public sealed class AnimeCollectionTask : IScheduledTask
    {
        private const string MappingUrl =
            "https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json";
        private const int MaxMappingBytes = 48 * 1024 * 1024;
        private readonly ILibraryManager _libraryManager;
        private readonly ICollectionManager _collections;
        private readonly IHttpClient _httpClient;
        private readonly IJsonSerializer _json;
        private readonly ILogger _logger;
        public static readonly List<string> ExecutionLog = new List<string>();
        public static string LastStatus { get; private set; } = "Never";
        public static DateTime? LastStartedUtc { get; private set; }
        public static bool IsRunning { get; private set; }

        public AnimeCollectionTask(ILibraryManager libraryManager, ICollectionManager collectionManager,
            IHttpClient httpClient, IJsonSerializer jsonSerializer, ILogManager logManager)
        {
            _libraryManager = libraryManager;
            _collections = collectionManager;
            _httpClient = httpClient;
            _json = jsonSerializer;
            _logger = logManager.GetLogger("HomeScreenCompanion_Anime");
        }

        public string Key => "HscAnimeEditionCollections";
        public string Name => "Anime IP Collection Sync";
        public string Description => "Opt-in anime franchise collections using AniBridge Mappings v3 and AniList.";
        public string Category => "Home Screen Companion Anime Edition";

        public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => new[]
        {
            new TaskTriggerInfo { Type = TaskTriggerInfo.TriggerDaily, TimeOfDayTicks = TimeSpan.FromHours(5).Ticks }
        };

        public async Task Execute(CancellationToken cancellationToken, IProgress<double> progress)
        {
            if (IsRunning) return;
            IsRunning = true;
            LastStatus = "Running...";
            LastStartedUtc = DateTime.UtcNow;
            lock (ExecutionLog) ExecutionLog.Clear();
            var config = Plugin.Instance?.Configuration;
            var log = new RunLog(ExecutionLog, _logger, "[Anime]", config?.ExtendedConsoleOutput ?? false);
            try
            {
                log.Info("Anime IP Collection Sync · " + DateTime.Now.ToString("yyyy-MM-dd HH:mm"));
                if (config == null || !config.AnimeEnabled)
                {
                    log.Skip("Disabled: enable Anime Collections in Settings to run.");
                    LastStatus = "Disabled";
                    return;
                }
                bool dryRun = config.DryRunMode || config.AnimeDryRun;
                if (dryRun) log.Warn("DRY RUN — no Emby collection will be modified.");
                var dataDir = Path.Combine(Plugin.Instance!.DataFolderPath, "anime");
                Directory.CreateDirectory(dataDir);

                var mappingPath = Path.Combine(dataDir, "anibridge-v3.json");
                await EnsureMappingsAsync(mappingPath, config.AnimeMappingRefreshDays, cancellationToken, log);
                var index = AnimeMappingIndex.Load(mappingPath);
                log.Info($"AniBridge: {index.SourceDescriptors} source descriptors, {index.IdentityLinks} identity links.");
                progress?.Report(15);

                var local = ScanLocalAnime(index, log);
                var seeds = local.SelectMany(x => x.AniListIds).Distinct().ToArray();
                if (seeds.Length == 0)
                {
                    LastStatus = "No AniList-mapped media";
                    log.Skip("No media with confirmed AniBridge identities; existing collections retained.");
                    return;
                }
                log.Info($"Matched {local.Count} Emby titles to {seeds.Length} AniList records.");
                progress?.Report(30);
                var client = new AnimeAniListClient(_json, dataDir);
                var graph = await client.ExpandAsync(seeds,
                    Math.Max(1, Math.Min(300, config.AnimeMaxRequestsPerRun)),
                    2400, 14, config.AnimeIncludeSpinOffs,
                    cancellationToken, log.Warn);
                log.Info($"AniList: {graph.NetworkRequests} API requests, {graph.Records.Count} graph records.");
                if (!graph.Complete)
                {
                    LastStatus = "Pending: AniList cache warm-up";
                    log.Warn("Relationship expansion incomplete. NO Emby changes. Run the task again after the API cooldown.");
                    return;
                }
                progress?.Report(60);

                if (config.AnimeAiReviewOtherEdges)
                    await ReviewAmbiguousRelationsAsync(graph.Records, local, config, dataDir, cancellationToken, log);
                var groups = AnimeGroupPlanner.Plan(local, graph.Records, config.AnimeIncludeSpinOffs);
                log.Info($"Planned {groups.Count} multi-title anime IP collections.");
                if (groups.Count == 0)
                {
                    LastStatus = "No multi-title groups";
                    log.Skip("No safe multi-title groups; existing collections retained.");
                    return;
                }
                await SyncCollectionsAsync(groups, dataDir, config, dryRun, cancellationToken, log, progress);
                LastStatus = dryRun ? $"Preview: {groups.Count} groups" : $"Synced: {groups.Count} groups";
                log.Ok(LastStatus);
                progress?.Report(100);
            }
            catch (OperationCanceledException)
            {
                LastStatus = "Canceled";
                log.Warn("Canceled; collections already synced before cancellation are tracked individually.");
                throw;
            }
            catch (Exception ex)
            {
                LastStatus = "Failed: " + ex.GetType().Name;
                log.Error("Sync aborted safely: " + ex.Message);
                throw; // Scheduler should show failure; never treat source failure as zero items.
            }
            finally
            {
                IsRunning = false;
                LogStore.Save("anime", ExecutionLog, LastStatus, LastStartedUtc);
            }
        }

        private List<AnimeLocalItem> ScanLocalAnime(AnimeMappingIndex index, RunLog log)
        {
            var all = _libraryManager.GetItemList(new InternalItemsQuery
            {
                IncludeItemTypes = new[] { "Movie", "Series" },
                Recursive = true,
                IsVirtualItem = false
            });
            var output = new List<AnimeLocalItem>();
            string topDir = Path.Combine(Plugin.Instance!.DataFolderPath, "toplists") + Path.DirectorySeparatorChar;
            foreach (var media in all)
            {
                if (media == null || media.InternalId <= 0 || media.IsVirtualItem ||
                    TopListCollectionMirror.IsTopListItem(media) ||
                    (!string.IsNullOrEmpty(media.Path) && media.Path.StartsWith(topDir, StringComparison.OrdinalIgnoreCase)))
                    continue;
                bool isSeries = media.GetType().Name == "Series";
                var ids = new HashSet<int>();
                void Add(string provider, string? sourceId)
                {
                    foreach (var animeId in index.Match(provider, sourceId ?? "")) ids.Add(animeId);
                }
                if (isSeries)
                {
                    Add("tmdb_show", media.GetProviderId("Tmdb"));
                    Add("tvdb_show", media.GetProviderId("Tvdb"));
                    Add("imdb_show", media.GetProviderId("Imdb"));
                }
                else
                {
                    Add("tmdb_movie", media.GetProviderId("Tmdb"));
                    Add("imdb_movie", media.GetProviderId("Imdb"));
                }
                if (ids.Count == 0) continue;
                output.Add(new AnimeLocalItem
                {
                    EmbyId = media.InternalId,
                    Name = media.Name ?? "",
                    IsSeries = isSeries,
                    AniListIds = ids.OrderBy(id => id).ToList()
                });
                log.Debug($"  {media.Name} ({media.InternalId}) -> {string.Join(",", ids.OrderBy(id => id))}");
            }
            return output;
        }

        private async Task EnsureMappingsAsync(string path, int refreshDays, CancellationToken token, RunLog log)
        {
            bool exists = File.Exists(path);
            if (exists && File.GetLastWriteTimeUtc(path) >= DateTime.UtcNow.AddDays(-Math.Max(1, refreshDays)))
                return;
            string tmp = path + ".download";
            try
            {
                using (var remote = await _httpClient.Get(new HttpRequestOptions { Url = MappingUrl, CancellationToken = token }))
                using (var dest = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    var buffer = new byte[65536];
                    long total = 0;
                    int read;
                    while ((read = await remote.ReadAsync(buffer, 0, buffer.Length, token)) > 0)
                    {
                        total += read;
                        if (total > MaxMappingBytes) throw new InvalidDataException("Mappings download exceeded size limit.");
                        await dest.WriteAsync(buffer, 0, read, token);
                    }
                }
                var parsed = AnimeMappingIndex.Load(tmp); // validate before replacing good cache
                if (parsed.IdentityLinks < 1000) throw new InvalidDataException("Mappings payload is unexpectedly small.");
                if (File.Exists(path)) File.Replace(tmp, path, null);
                else File.Move(tmp, path);
                log.Ok("AniBridge mappings refreshed and validated.");
            }
            catch
            {
                if (!exists) throw;
                // Stale data is not silently used: external failure aborts this run without
                // updating Emby and preserves the last good mapping snapshot.
                throw;
            }
            finally
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
            }
        }

        private async Task SyncCollectionsAsync(List<AnimeGroup> groups, string dataDir, PluginConfiguration config,
            bool dryRun, CancellationToken token, RunLog log, IProgress<double>? progress)
        {
            string stateFile = Path.Combine(dataDir, "owned-collections.json");
            var state = File.Exists(stateFile)
                ? (_json.DeserializeFromFile<AnimeCollectionState>(stateFile) ?? new AnimeCollectionState())
                : new AnimeCollectionState();
            var existing = _libraryManager.GetItemList(new InternalItemsQuery
            {
                IncludeItemTypes = new[] { "BoxSet" }, Recursive = true
            }).ToList();
            int made = 0, updated = 0, collisions = 0;
            // Missing mapping data does not justify removing a former member. Only move
            // a member when it has been positively assigned to another resolved IP.
            var confirmedReassignments = new HashSet<long>(groups.SelectMany(g => g.EmbyIds));
            // If one previously managed IP has split into several groups, do not let the
            // first group strip members belonging to the second. Resolve that split manually.
            var splitIds = new HashSet<long>();
            foreach (var prior in state.Collections)
            {
                if (groups.Count(g => g.EmbyIds.Any(prior.ManagedItemIds.Contains)) > 1)
                    splitIds.Add(prior.CollectionId);
            }
            var visitedOwned = new HashSet<long>();
            for (int i = 0; i < groups.Count; i++)
            {
                token.ThrowIfCancellationRequested();
                var group = groups[i];
                var desired = new HashSet<long>(group.EmbyIds);
                // Stable owned identity is the Emby collection ID. AniList anchor may shift
                // when a new prequel arrives, so use previously managed member overlap too.
                var matches = state.Collections.Where(c => c.ManagedItemIds.Any(desired.Contains)).ToList();
                if (matches.Count > 1)
                {
                    log.Warn($"Skipped {group.Name}: overlaps multiple owned collections; manual review required.");
                    collisions++;
                    continue;
                }
                var owned = matches.Count == 1 ? matches[0] : null;
                if (owned != null && (splitIds.Contains(owned.CollectionId) || !visitedOwned.Add(owned.CollectionId)))
                {
                    log.Warn($"Skipped {group.Name}: managed IP was split into conflicting groups.");
                    collisions++;
                    continue;
                }
                BaseItem? box = owned == null ? null : existing.FirstOrDefault(x => x.InternalId == owned.CollectionId);
                if (owned != null && box == null)
                {
                    log.Warn($"Skipped {group.Name}: previously owned collection disappeared; will not adopt a replacement.");
                    collisions++;
                    continue;
                }
                var name = (config.AnimeCollectionPrefix ?? "动漫 · ") + group.Name;
                var collision = existing.FirstOrDefault(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
                if (owned == null && collision != null)
                {
                    log.Warn($"Skipped {name}: existing collection is not owned by Anime Edition.");
                    collisions++;
                    continue;
                }
                if (owned == null)
                {
                    log.Info($"{(dryRun ? "Would create" : "Create")} '{name}' ({desired.Count} titles)");
                    if (!dryRun)
                    {
                        var created = await _collections.CreateCollection(new CollectionCreationOptions
                        {
                            Name = name, IsLocked = false, ItemIdList = desired.ToArray()
                        });
                        if (created == null) throw new InvalidOperationException("Emby did not return the new collection.");
                        existing.Add(created);
                        state.Collections.Add(new AnimeManagedCollection
                        {
                            CollectionId = created.InternalId,
                            Anchor = group.Anchor,
                            Name = name,
                            ManagedItemIds = desired.OrderBy(id => id).ToList()
                        });
                        SaveState(stateFile, state);
                    }
                    made++;
                }
                else
                {
                    var current = new HashSet<long>(_libraryManager.GetItemList(new InternalItemsQuery
                    {
                        CollectionIds = new[] { box!.InternalId }, Recursive = true, IsVirtualItem = false
                    }).Where(x => !TopListCollectionMirror.IsTopListItem(x)).Select(x => x.InternalId));
                    var toAdd = desired.Where(id => !current.Contains(id)).ToArray();
                    var prevOwned = new HashSet<long>(owned.ManagedItemIds);
                    // Never strip user-added members. Only remove a member previously managed
                    // by this module which is no longer in a fully-resolved IP group.
                    var toRemove = prevOwned.Where(id => !desired.Contains(id) &&
                        current.Contains(id) && confirmedReassignments.Contains(id)).ToArray();
                    if (toAdd.Length > 0 || toRemove.Length > 0)
                    {
                        log.Info($"{(dryRun ? "Would update" : "Update")} '{owned.Name}': +{toAdd.Length}, -{toRemove.Length}");
                        if (!dryRun)
                        {
                            if (toAdd.Length > 0) await _collections.AddToCollection(box.InternalId, toAdd);
                            if (toRemove.Length > 0 && box is BoxSet set) _collections.RemoveFromCollection(set, toRemove);
                        }
                        updated++;
                    }
                    if (!dryRun)
                    {
                        owned.Anchor = group.Anchor;
                        owned.ManagedItemIds = AnimeCollectionMembership.NextOwned(prevOwned, toAdd, toRemove);
                        SaveState(stateFile, state);
                    }
                }
                progress?.Report(65.0 + 35.0 * (i + 1) / groups.Count);
            }
            log.Ok($"{(dryRun ? "Planned" : "Applied")}: {made} new, {updated} updates, {collisions} conflicts.");
            if (!dryRun)
                log.Info("Existing collections and manually added members are preserved; orphaned collections are never auto-deleted.");
        }

        private void SaveState(string path, AnimeCollectionState state)
        {
            var text = _json.SerializeToString(state);
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, text, Encoding.UTF8);
            if (File.Exists(path)) File.Replace(tmp, path, null);
            else File.Move(tmp, path);
        }

        private async Task ReviewAmbiguousRelationsAsync(List<AnimeRelationRecord> records,
            List<AnimeLocalItem> local, PluginConfiguration config, string dir,
            CancellationToken token, RunLog log)
        {
            // AI can only promote an AniList-verified OTHER relationship between two items
            // already matched to AniList IDs. It can never invent or overwrite identities.
            var matched = new HashSet<int>(local.SelectMany(x => x.AniListIds));
            var titleById = local.SelectMany(x => x.AniListIds.Select(id => new { id, x.Name }))
                .GroupBy(x => x.id).ToDictionary(x => x.Key, x => x.First().Name);
            var choices = records.Where(r => matched.Contains(r.Id))
                .SelectMany(r => r.Relations.Where(e => e.Type == "ANIME" && e.Relation == "OTHER" && matched.Contains(e.Id))
                    .Select(e => new { Source = r, Edge = e })).ToList();
            if (choices.Count == 0) return;
            var file = Path.Combine(dir, "anime-ai-decisions.json");
            AnimeAiDecisionCache cache;
            try { cache = File.Exists(file) ? (_json.DeserializeFromFile<AnimeAiDecisionCache>(file) ?? new AnimeAiDecisionCache()) : new AnimeAiDecisionCache(); }
            catch { cache = new AnimeAiDecisionCache(); }
            var fetcher = new ListFetcher(_httpClient, _json);
            var seen = new HashSet<string>();
            int queries = 0;
            bool dirty = false;
            try
            {
                foreach (var pair in choices)
                {
                    token.ThrowIfCancellationRequested();
                    string key = Math.Min(pair.Source.Id, pair.Edge.Id) + ":" + Math.Max(pair.Source.Id, pair.Edge.Id);
                    if (!seen.Add(key)) continue;
                    string a = titleById.TryGetValue(pair.Source.Id, out var ta) ? ta : pair.Source.Name;
                    string b = titleById.TryGetValue(pair.Edge.Id, out var tb) ? tb : pair.Edge.Name;
                    bool accept;
                    if (cache.Decisions.TryGetValue(key, out var old) && old.CheckedUtc > DateTime.UtcNow.AddDays(-60))
                    {
                        accept = old.Approved;
                    }
                    else
                    {
                        if (queries >= 15) { log.Warn("AI review cap reached; remaining OTHER links excluded."); break; }
                        queries++;
                        try { accept = await fetcher.CheckAnimeRelationAsync(config, a, b, token); }
                        catch (Exception ex) { log.Warn("AI review unavailable: " + ex.Message); break; }
                        cache.Decisions[key] = new AnimeAiDecisionEntry { Approved = accept, CheckedUtc = DateTime.UtcNow };
                        dirty = true;
                    }
                    if (accept)
                    {
                        pair.Edge.Relation = "SIDE_STORY"; // only the in-memory plan
                        log.Info($"AI accepted an AniList OTHER link: {a} ↔ {b}");
                    }
                }
            }
            finally
            {
                if (dirty)
                {
                    var tmp = file + ".tmp";
                    File.WriteAllText(tmp, _json.SerializeToString(cache), Encoding.UTF8);
                    if (File.Exists(file)) File.Replace(tmp, file, null);
                    else File.Move(tmp, file);
                }
            }
        }
    }
}
