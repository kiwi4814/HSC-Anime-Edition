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

        internal static void RestoreLog()
        {
            var saved = LogStore.Load(LogStore.Anime);
            if (saved == null || IsRunning) return;
            lock (ExecutionLog)
            {
                if (ExecutionLog.Count > 0) return;
                ExecutionLog.AddRange(saved.Lines ?? new List<string>());
            }
            var status = LogStore.RestoredStatus(saved.Status);
            LastStatus = status == LogStore.InterruptedStatus ? "已中断（服务器已重启）" : status;
            LastStartedUtc = saved.StartedUtc;
        }

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
        public string Name => "动漫合集同步";
        public string Description => "按作品系列整理动漫合集。需先在插件设置中启用。";
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
            var log = new RunLog(ExecutionLog, _logger, "[Anime]", config?.ExtendedConsoleOutput ?? false);
            try
            {
                log.Info("动漫合集同步  ·  " + DateTime.Now.ToString("yyyy-MM-dd HH:mm"));
                if (config == null || !config.AnimeEnabled)
                {
                    log.Skip("功能未启用：请先在设置中启用动漫合集。");
                    LastStatus = "未启用";
                    return;
                }
                var policy = AnimeCollectionPolicy.Parse(config.AnimeCollectionRulesJson,
                    config.AnimeApprovedCollectionKeys, config.AnimeCollectionAliasesJson);
                bool dryRun = config.DryRunMode || config.AnimeDryRun;
                if (dryRun) log.Warn("仅预览 — 不会修改任何合集。");
                var dataDir = Path.Combine(Plugin.Instance!.DataFolderPath, "anime");
                Directory.CreateDirectory(dataDir);

                var mappingPath = Path.Combine(dataDir, "anibridge-v3.json");
                await EnsureMappingsAsync(mappingPath, config.AnimeMappingRefreshDays, cancellationToken, log);
                var index = AnimeMappingIndex.Load(mappingPath);
                log.Debug($"AniBridge 映射：{index.SourceDescriptors} 条来源描述，{index.IdentityLinks} 条身份映射");
                progress?.Report(15);

                var local = ScanLocalAnime(index, log);
                var seeds = local.SelectMany(x => x.AniListIds).Distinct().ToArray();
                foreach (var duplicate in AnimeCollectionPolicy.FindDuplicates(local))
                    { log.Warn($"疑似重复媒体：{duplicate.Identifier}（{duplicate.EmbyIds.Count} 个项目）。仅提示，不会处理。"); log.Debug($"  重复媒体 {duplicate.Identifier} 的 Emby ID：{string.Join(", ", duplicate.EmbyIds)}"); }
                log.Info($"扫描 {local.Count} 个电影/剧集项目，匹配 {seeds.Length} 条 AniList 记录。");
                progress?.Report(30);
                var client = new AnimeAniListClient(_json, dataDir);
                int requestBudget = Math.Max(1, Math.Min(600, config.AnimeMaxRequestsPerRun));
                const int graphNodeLimit = 8000;
                var graph = await client.ExpandAsync(seeds,
                    requestBudget, graphNodeLimit, 14, config.AnimeIncludeSpinOffs,
                    cancellationToken, msg =>
                    {
                        if (msg.IndexOf("上限", StringComparison.Ordinal) >= 0) log.Warn(msg);
                        else log.Info(msg);
                    });
                log.Info($"AniList：{graph.NetworkRequests} 次请求，{graph.Records.Count} 条关系记录。");
                if (!graph.Complete)
                {
                    if (graph.IncompleteReason == "node_limit")
                    {
                        LastStatus = "失败：作品关系超过上限（" + graphNodeLimit + "）";
                        log.Warn("作品关系节点数超过上限（" + graphNodeLimit + "），本次未修改合集。调高每次请求数也无法突破此上限；可缩小扫描范围，或等待后续版本。");
                    }
                    else
                    {
                        LastStatus = "等待：AniList 请求配额已用完，请再次运行";
                        log.Warn("AniList 关系数据尚未获取完整（本次新请求 " + graph.NetworkRequests + "/" + requestBudget + "），本次不修改合集。请再次运行任务以继续获取。");
                    }
                    return;
                }
                progress?.Report(60);

                var groups = policy.Apply(AnimeGroupPlanner.Plan(local, graph.Records, config.AnimeIncludeSpinOffs), local);
                log.Info($"找到 {groups.Count} 个候选合集。");
                if (groups.Count == 0)
                {
                    LastStatus = "没有合集候选";
                    log.Skip("没有符合条件的候选合集，现有合集保持不变。");
                    await AnalyzeCollectionsAsync(config, local, graph.Records, groups, dataDir, cancellationToken, log);
                    return;
                }
                await SyncCollectionsAsync(groups, policy, dataDir, config, dryRun, cancellationToken, log, progress);
                await AnalyzeCollectionsAsync(config, local, graph.Records, groups, dataDir, cancellationToken, log);
                int writable = groups.Count(g => policy.CanWrite(g, dryRun));
                LastStatus = dryRun ? $"仅预览：{groups.Count} 个候选" : $"已完成：{writable} 个已批准合集";
                log.Ok(LastStatus);
                progress?.Report(100);
            }
            catch (OperationCanceledException)
            {
                LastStatus = "已取消";
                log.Warn("任务已取消，已处理的合集不受影响。");
                throw;
            }
            catch (Exception ex)
            {
                LastStatus = "失败（详见日志）";
                log.Error("同步已中止：" + ex.Message);
                log.Debug("异常类型：" + ex.GetType().FullName);
                throw; // Scheduler should show failure; never treat source failure as zero items.
            }
            finally
            {
                IsRunning = false;
                LogStore.Save(LogStore.Anime, ExecutionLog, LastStatus, LastStartedUtc);
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
                log.Ok("动漫映射数据已更新。");
                log.Debug($"AniBridge 映射已刷新并通过校验：{path}");
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
                ? (_json.DeserializeFromFile<AnimeCollectionState>(stateFile) ?? throw new InvalidDataException("合集归属记录为空，已停止写入。"))
                : new AnimeCollectionState();
            if (state.Collections == null || state.Collections.Any(c => c == null || c.CollectionId <= 0 ||
                c.Anchor <= 0 || c.ManagedItemIds == null) ||
                state.Collections.GroupBy(c => c.CollectionId).Any(g => g.Count() > 1) ||
                state.Collections.GroupBy(c => c.Anchor).Any(g => g.Count() > 1))
                throw new InvalidDataException("合集归属记录中有无效或重复的条目，已停止写入。");
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
                    log.Skip($"已跳过 [{group.Key}] {group.Name}：未在批准名单中、少于两部作品，或有分支尚未用成员规则确认。");
                    log.Debug($"  [{group.Key}] 成员 Emby ID：{string.Join(", ", group.EmbyIds)}");
                    blocked++;
                    continue;
                }
                bool mayWrite = policy.CanWrite(group, dryRun);
                var desired = new HashSet<long>(group.EmbyIds);
                var matches = state.Collections.Where(c => c.Anchor == group.Anchor || c.ManagedItemIds.Any(desired.Contains)).ToList();
                if (matches.Count > 1)
                {
                    log.Warn($"已跳过 [{group.Key}] {group.Name}：与多个由插件创建的合集重叠，请人工检查。");
                    collisions++;
                    continue;
                }
                var owned = matches.Count == 1 ? matches[0] : null;
                if (owned != null && (splitIds.Contains(owned.CollectionId) || !visitedOwned.Add(owned.CollectionId)))
                {
                    log.Warn($"已跳过 [{group.Key}] {group.Name}：原合集已拆分成多个分组，请人工检查。");
                    collisions++;
                    continue;
                }
                BaseItem? box = owned == null ? null : existing.FirstOrDefault(x => x.InternalId == owned.CollectionId);
                var name = (config.AnimeCollectionPrefix ?? "动漫 · ") + group.Name;
                var nameMatches = existing.Where(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase))
                    .Select(x => x.InternalId).ToList();
                if (!AnimeCollectionPolicy.CanUseIdentity(owned?.CollectionId, box?.InternalId, nameMatches))
                {
                    log.Warn($"已跳过 [{group.Key}] {name}：原合集已不存在，或名称与其他合集重复。手工创建的合集不会被改动。");
                    collisions++;
                    continue;
                }
                if (owned == null)
                {
                    log.Info($"{(mayWrite ? "创建" : "预计创建")} [{group.Key}]“{name}”（{desired.Count} 部）。");
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
                        log.Info($"[{group.Key}] 保留现有合集名称“{box.Name}”；别名“{name}”只在新建合集时使用。");
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
                        log.Warn($"已跳过 [{group.Key}]：无法从此合集移除成员。");
                        collisions++;
                        continue;
                    }
                    if (toAdd.Length > 0 || toRemove.Length > 0)
                    {
                        log.Info($"{(mayWrite ? "更新" : "预计更新")} [{group.Key}]“{box.Name}”：+{toAdd.Length}，-{toRemove.Length}。");
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
            log.Ok($"{(dryRun ? "仅预览" : "已完成")}：新建 {made} 个，更新 {updated} 个，冲突 {collisions} 个，跳过 {blocked} 个。");
            log.Debug("不会删除合集，也不会移除手工添加的成员。");
        }

        private void SaveState(string path, AnimeCollectionState state)
        {
            var text = _json.SerializeToString(state);
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, text, Encoding.UTF8);
            if (File.Exists(path)) File.Replace(tmp, path, null);
            else File.Move(tmp, path);
        }

        private async Task AnalyzeCollectionsAsync(PluginConfiguration config, List<AnimeLocalItem> local,
            List<AnimeRelationRecord> records, List<AnimeGroup> groups, string dir,
            CancellationToken token, RunLog log)
        {
            if (!config.AnimeAiReviewOtherEdges && !config.AnimeAiNamingEnabled && !config.AnimeAiCollectionReviewEnabled)
                return;
            try
            {
                await new AnimeAiAnalysisService(_json).AnalyzeAsync(config, local, records, groups, dir, token, log.Warn);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception)
            {
                log.Warn("AI 分析未完成，合集处理不受影响。请检查 AI 设置和服务状态。");
            }
        }
    }
}
