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
        public static string LastStatus { get; private set; } = "尚未运行";
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
        public string Name => "动漫 IP 合集同步";
        public string Description => "按需启用，使用 AniBridge Mappings v3、AniList 和经批准的成员规则整理动漫合集。";
        public string Category => "Home Screen Companion 动漫版";

        public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => new[]
        {
            new TaskTriggerInfo { Type = TaskTriggerInfo.TriggerDaily, TimeOfDayTicks = TimeSpan.FromHours(5).Ticks }
        };

        public async Task Execute(CancellationToken cancellationToken, IProgress<double> progress)
        {
            if (IsRunning) return;
            IsRunning = true;
            LastStatus = "正在运行…";
            LastStartedUtc = DateTime.UtcNow;
            lock (ExecutionLog) ExecutionLog.Clear();
            var config = Plugin.Instance?.Configuration;
            var log = new RunLog(ExecutionLog, _logger, "[动漫]", config?.ExtendedConsoleOutput ?? false);
            try
            {
                log.Info("动漫 IP 合集同步 · " + DateTime.Now.ToString("yyyy-MM-dd HH:mm"));
                if (config == null || !config.AnimeEnabled)
                {
                    log.Skip("功能未启用：请先在设置中启用动漫合集。");
                    LastStatus = "未启用";
                    return;
                }
                var policy = AnimeCollectionPolicy.Parse(config.AnimeCollectionRulesJson,
                    config.AnimeApprovedCollectionKeys, config.AnimeCollectionAliasesJson);
                bool dryRun = config.DryRunMode || config.AnimeDryRun;
                if (dryRun) log.Warn("预演模式：不会修改任何 Emby 合集或合集归属记录。");
                var dataDir = Path.Combine(Plugin.Instance!.DataFolderPath, "anime");
                Directory.CreateDirectory(dataDir);

                var mappingPath = Path.Combine(dataDir, "anibridge-v3.json");
                await EnsureMappingsAsync(mappingPath, config.AnimeMappingRefreshDays, cancellationToken, log);
                var index = AnimeMappingIndex.Load(mappingPath);
                log.Info($"AniBridge：{index.SourceDescriptors} 条来源描述，{index.IdentityLinks} 条身份映射。");
                progress?.Report(15);

                var local = ScanLocalAnime(index, log);
                var seeds = local.SelectMany(x => x.AniListIds).Distinct().ToArray();
                foreach (var duplicate in AnimeCollectionPolicy.FindDuplicates(local))
                    log.Warn($"疑似重复媒体 [{duplicate.Identifier}]：Emby {string.Join("、", duplicate.EmbyIds)}。仅提示，不会合并或删除媒体。");
                log.Info($"扫描 {local.Count} 个电影/剧集条目，匹配 {seeds.Length} 条 AniList 记录。");
                progress?.Report(30);
                var client = new AnimeAniListClient(_json, dataDir);
                var graph = await client.ExpandAsync(seeds,
                    Math.Max(1, Math.Min(300, config.AnimeMaxRequestsPerRun)),
                    2400, 14, config.AnimeIncludeSpinOffs,
                    cancellationToken, log.Warn);
                log.Info($"AniList：{graph.NetworkRequests} 次请求，{graph.Records.Count} 条关系记录。");
                if (!graph.Complete)
                {
                    LastStatus = "等待：AniList 缓存预热";
                    log.Warn("关系图尚未解析完整，不会修改 Emby；请在 API 冷却后再次运行。");
                    return;
                }
                progress?.Report(60);

                if (config.AnimeAiReviewOtherEdges)
                    await ReviewAmbiguousRelationsAsync(graph.Records, local, config, dataDir, cancellationToken, log);
                var groups = policy.Apply(AnimeGroupPlanner.Plan(local, graph.Records, config.AnimeIncludeSpinOffs), local);
                log.Info($"规划 {groups.Count} 个合集候选；每个合集仍须通过精确批准列表和分支审核。");
                if (groups.Count == 0)
                {
                    LastStatus = "没有合集候选";
                    log.Skip("没有安全的多媒体分组，保留现有合集。");
                    return;
                }
                await SyncCollectionsAsync(groups, policy, dataDir, config, dryRun, cancellationToken, log, progress);
                int writable = groups.Count(g => policy.CanWrite(g, dryRun));
                LastStatus = dryRun ? $"预演：{groups.Count} 个候选" : $"处理完成：{writable} 个获批候选（冲突会跳过）";
                log.Ok(LastStatus);
                progress?.Report(100);
            }
            catch (OperationCanceledException)
            {
                LastStatus = "已取消";
                log.Warn("任务已取消；取消前已同步的合集已逐个保存归属记录。");
                throw;
            }
            catch (Exception ex)
            {
                LastStatus = "失败：" + ex.GetType().Name;
                log.Error("同步已安全中止：" + ex.Message);
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
                var providerIds = new HashSet<string>(StringComparer.Ordinal);
                void Add(string provider, string? sourceId)
                {
                    var normalized = (sourceId ?? "").Trim().ToLowerInvariant();
                    var typed = provider + ":" + normalized;
                    if (!AnimeCollectionPolicy.IsIdentifier(typed)) return;
                    providerIds.Add(typed);
                    foreach (var animeId in index.Match(provider, normalized)) ids.Add(animeId);
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
                    Add("tvdb_movie", media.GetProviderId("Tvdb"));
                    Add("imdb_movie", media.GetProviderId("Imdb"));
                }
                output.Add(new AnimeLocalItem
                {
                    EmbyId = media.InternalId,
                    Name = media.Name ?? "",
                    IsSeries = isSeries,
                    AniListIds = ids.OrderBy(id => id).ToList(),
                    ProviderIds = providerIds.OrderBy(id => id, StringComparer.Ordinal).ToList()
                });
                log.Debug($"  {media.Name}（Emby {media.InternalId}）→ AniList {string.Join("、", ids.OrderBy(id => id))}");
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
                        if (total > MaxMappingBytes) throw new InvalidDataException("映射下载超过大小限制。");
                        await dest.WriteAsync(buffer, 0, read, token);
                    }
                }
                var parsed = AnimeMappingIndex.Load(tmp); // validate before replacing good cache
                if (parsed.IdentityLinks < 1000) throw new InvalidDataException("映射文件的数据量异常偏小。");
                if (File.Exists(path)) File.Replace(tmp, path, null);
                else File.Move(tmp, path);
                log.Ok("AniBridge 映射已刷新并通过校验。");
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

        private async Task SyncCollectionsAsync(List<AnimeGroup> groups, AnimeCollectionPolicy policy,
            string dataDir, PluginConfiguration config, bool dryRun, CancellationToken token,
            RunLog log, IProgress<double>? progress)
        {
            string stateFile = Path.Combine(dataDir, "owned-collections.json");
            var state = File.Exists(stateFile)
                ? (_json.DeserializeFromFile<AnimeCollectionState>(stateFile) ?? throw new InvalidDataException("合集归属记录为空，拒绝写入。"))
                : new AnimeCollectionState();
            if (state.Collections == null || state.Collections.Any(c => c == null || c.CollectionId <= 0 ||
                c.Anchor <= 0 || c.ManagedItemIds == null) ||
                state.Collections.GroupBy(c => c.CollectionId).Any(g => g.Count() > 1) ||
                state.Collections.GroupBy(c => c.Anchor).Any(g => g.Count() > 1))
                throw new InvalidDataException("合集归属记录存在无效或重复身份，拒绝写入。");
            var existing = _libraryManager.GetItemList(new InternalItemsQuery
            {
                IncludeItemTypes = new[] { "BoxSet" }, Recursive = true
            }).ToList();
            int made = 0, updated = 0, collisions = 0, blocked = 0;
            var confirmedReassignments = new HashSet<long>(groups.Where(g => policy.CanWrite(g, false)).SelectMany(g => g.EmbyIds));
            // Detect splits against ALL candidates, including denied and review-blocked groups.
            // Filtering to the approved writer set first could strip a denied sibling's members.
            var splitIds = AnimeCollectionPolicy.FindSplitCollectionIds(groups, state.Collections);
            var visitedOwned = new HashSet<long>();
            for (int i = 0; i < groups.Count; i++)
            {
                token.ThrowIfCancellationRequested();
                var group = groups[i];
                if (!policy.CanWrite(group, false))
                {
                    log.Skip($"[{group.Key}] {group.Name}：未获精确批准、成员不足两部或存在未经显式规则确认的分支；不写入合集及归属记录。成员：{string.Join("、", group.EmbyIds)}");
                    blocked++;
                    continue;
                }
                bool mayWrite = policy.CanWrite(group, dryRun);
                var desired = new HashSet<long>(group.EmbyIds);
                var matches = state.Collections.Where(c => c.Anchor == group.Anchor || c.ManagedItemIds.Any(desired.Contains)).ToList();
                if (matches.Count > 1)
                {
                    log.Warn($"跳过 [{group.Key}] {group.Name}：与多个受管合集重叠，需人工复核。");
                    collisions++;
                    continue;
                }
                var owned = matches.Count == 1 ? matches[0] : null;
                if (owned != null && (splitIds.Contains(owned.CollectionId) || !visitedOwned.Add(owned.CollectionId)))
                {
                    log.Warn($"跳过 [{group.Key}] {group.Name}：原受管 IP 已拆分为冲突分组。");
                    collisions++;
                    continue;
                }
                BaseItem? box = owned == null ? null : existing.FirstOrDefault(x => x.InternalId == owned.CollectionId);
                var name = (config.AnimeCollectionPrefix ?? "动漫 · ") + group.Name;
                var nameMatches = existing.Where(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase))
                    .Select(x => x.InternalId).ToList();
                if (!AnimeCollectionPolicy.CanUseIdentity(owned?.CollectionId, box?.InternalId, nameMatches))
                {
                    log.Warn($"跳过 [{group.Key}] {name}：受管合集已消失或名称/别名与其他现有合集冲突；绝不接管手工合集。");
                    collisions++;
                    continue;
                }
                if (owned == null)
                {
                    log.Info($"{(mayWrite ? "创建" : "预演创建")} [{group.Key}]“{name}”（{desired.Count} 部）。");
                    if (mayWrite)
                    {
                        var created = await _collections.CreateCollection(new CollectionCreationOptions
                        {
                            Name = name, IsLocked = false, ItemIdList = desired.ToArray()
                        });
                        if (created == null || created.InternalId <= 0) throw new InvalidOperationException("Emby 未返回有效的新合集。");
                        existing.Add(created);
                        state.Collections.Add(new AnimeManagedCollection
                        {
                            CollectionId = created.InternalId, Anchor = group.Anchor, Name = name,
                            ManagedItemIds = desired.OrderBy(id => id).ToList()
                        });
                        SaveState(stateFile, state);
                    }
                    made++;
                }
                else
                {
                    if (!string.Equals(box!.Name, name, StringComparison.Ordinal))
                        log.Info($"[{group.Key}] 别名“{name}”仅用于新建合集；保留现有合集名称“{box.Name}”，不自动重命名。");
                    var current = new HashSet<long>(_libraryManager.GetItemList(new InternalItemsQuery
                    {
                        CollectionIds = new[] { box.InternalId }, Recursive = true, IsVirtualItem = false
                    }).Where(x => !TopListCollectionMirror.IsTopListItem(x)).Select(x => x.InternalId));
                    var toAdd = desired.Where(id => !current.Contains(id)).ToArray();
                    var prevOwned = new HashSet<long>(owned.ManagedItemIds);
                    // Exact rules may remove disallowed plugin-owned members even without
                    // reassignment. User additions are never claimed or removed.
                    var toRemove = AnimeCollectionPolicy.PlanRemovals(group, prevOwned, current, confirmedReassignments);
                    if (toRemove.Length > 0 && !(box is BoxSet))
                    {
                        log.Warn($"跳过 [{group.Key}]：合集类型无法安全移除成员。");
                        collisions++;
                        continue;
                    }
                    if (toAdd.Length > 0 || toRemove.Length > 0)
                    {
                        log.Info($"{(mayWrite ? "更新" : "预演更新")} [{group.Key}]“{box.Name}”：+{toAdd.Length}，-{toRemove.Length}。");
                        if (mayWrite)
                        {
                            if (toAdd.Length > 0) await _collections.AddToCollection(box.InternalId, toAdd);
                            if (toRemove.Length > 0) _collections.RemoveFromCollection((BoxSet)box, toRemove);
                        }
                        updated++;
                    }
                    if (mayWrite)
                    {
                        owned.Anchor = group.Anchor;
                        owned.ManagedItemIds = AnimeCollectionMembership.NextOwned(prevOwned, toAdd, toRemove);
                        SaveState(stateFile, state);
                    }
                }
                progress?.Report(65.0 + 35.0 * (i + 1) / groups.Count);
            }
            log.Ok($"{(dryRun ? "预演" : "处理完成")}：新建 {made} 个，更新 {updated} 个，冲突 {collisions} 个，安全拦截 {blocked} 个。");
            log.Info("保留手工合集及手工添加的成员；孤立合集和少于两部的显式规则结果不会自动删除或清空。");
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
                        if (queries >= 15) { log.Warn("已达到 AI 复核次数上限，其余 OTHER 关系不会纳入。"); break; }
                        queries++;
                        try { accept = await fetcher.CheckAnimeRelationAsync(config, a, b, token); }
                        catch (Exception ex) { log.Warn("AI 复核不可用：" + ex.Message); break; }
                        cache.Decisions[key] = new AnimeAiDecisionEntry { Approved = accept, CheckedUtc = DateTime.UtcNow };
                        dirty = true;
                    }
                    if (accept)
                    {
                        pair.Edge.Relation = "SIDE_STORY"; // only the in-memory plan
                        log.Info($"AI 已确认 AniList OTHER 关系：{a} ↔ {b}；分支仍须使用显式成员规则。");
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
