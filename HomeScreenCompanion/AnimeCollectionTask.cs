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

    /// <summary>Last anime sync card summary for the Anime tab UI (P0/P1).</summary>
    public sealed class AnimeLastRunSummary
    {
        public bool DryRun { get; set; }
        public bool GlobalDryRun { get; set; }
        public string FinishedUtc { get; set; } = "";
        public string StatusText { get; set; } = "";
        public int Created { get; set; }
        public int Updated { get; set; }
        public int Skipped { get; set; }
        public int Unchanged { get; set; }
        /// <summary>Unhandled reminder count (persisted; not shown on main UI path).</summary>
        public int Reminders { get; set; }
        public List<AnimeRunCard> Cards { get; set; } = new List<AnimeRunCard>();
        public List<AnimeOwnedCard> Owned { get; set; } = new List<AnimeOwnedCard>();
        /// <summary>Structured reminders persisted in anime/last-run-summary.json (P1).</summary>
        public List<AnimeReminder> ReminderItems { get; set; } = new List<AnimeReminder>();
    }

    /// <summary>One sync reminder (human labels on the anime tab).</summary>
    public sealed class AnimeReminder
    {
        public string Id { get; set; } = "";
        public string CollectionKey { get; set; } = "";
        public string CollectionName { get; set; } = "";
        /// <summary>branch | cross_ip | duplicate | naming | missing_local | cannot_write</summary>
        public string Type { get; set; } = "";
        public string TypeLabel { get; set; } = "";
        public string Reason { get; set; } = "";
        /// <summary>Optional suggested display name (naming reminders); empty otherwise.</summary>
        public string SuggestedName { get; set; } = "";
        public bool Handled { get; set; }
        public string RaisedUtc { get; set; } = "";
    }

    public sealed class AnimeRunCard
    {
        public string Key { get; set; } = "";
        public string Name { get; set; } = "";
        /// <summary>will_create | will_update | created | updated | unchanged | skipped</summary>
        public string Status { get; set; } = "";
        public string Reason { get; set; } = "";
        public int MemberCount { get; set; }
        public List<string> MemberTitles { get; set; } = new List<string>();
        /// <summary>Primary include ids aligned with MemberTitles (for P2 editor).</summary>
        public List<string> MemberIncludeIds { get; set; } = new List<string>();
        public int MoreCount { get; set; }
        public bool HasReminder { get; set; }
    }

    public sealed class AnimeOwnedCard
    {
        public long CollectionId { get; set; }
        public string Key { get; set; } = "";
        public string Name { get; set; } = "";
        public int MemberCount { get; set; }
        public bool HasReminder { get; set; }
    }

    /// <summary>In-memory result of one sync pass before reminder finalize.</summary>
    internal sealed class AnimeSyncRunResult
    {
        public bool DryRun { get; set; }
        public int Made { get; set; }
        public int Updated { get; set; }
        public int Skipped { get; set; }
        public int Unchanged { get; set; }
        public List<AnimeRunCard> Cards { get; set; } = new List<AnimeRunCard>();
        public List<AnimeReminder> Reminders { get; set; } = new List<AnimeReminder>();
        public AnimeCollectionState State { get; set; } = new AnimeCollectionState();
        public List<BaseItem> Existing { get; set; } = new List<BaseItem>();
    }

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

        /// <summary>0=normal scheduled, 1=manual preview (force dry), 2=confirm create (force write unless global DryRun).</summary>
        private static int _manualRunMode;
        private static readonly object ManualRunLock = new object();

        /// <summary>Next Execute will force dry-run (manual「立即同步」预览).</summary>
        internal static void RequestManualPreview()
        {
            lock (ManualRunLock) { _manualRunMode = 1; }
        }

        /// <summary>Next Execute will write (manual「一键创建」), unless global DryRunMode.</summary>
        internal static void RequestManualConfirmWrite()
        {
            lock (ManualRunLock) { _manualRunMode = 2; }
        }

        private static int ConsumeManualRunMode()
        {
            lock (ManualRunLock)
            {
                int mode = _manualRunMode;
                _manualRunMode = 0;
                return mode;
            }
        }

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
                int manualMode = ConsumeManualRunMode();
                // Global DryRunMode always blocks writes. Manual preview forces dry; scheduled/confirm write.
                // AnimeDryRun is deprecated (ignored); timed runs write by default.
                bool dryRun = config.DryRunMode || manualMode == 1;
                if (manualMode == 2 && !config.DryRunMode) dryRun = false;
                if (manualMode == 1) log.Info("手动同步：仅预览，等待确认后再写入。");
                else if (manualMode == 2 && !config.DryRunMode) log.Info("确认创建：按本趟决定写入合集。");
                if (dryRun) log.Warn("仅预览 — 不会修改任何合集。");
                var dataDir = Path.Combine(Plugin.Instance!.DataFolderPath, "anime");
                Directory.CreateDirectory(dataDir);

                var mappingPath = Path.Combine(dataDir, "anibridge-v3.json");
                await EnsureMappingsAsync(mappingPath, config.AnimeMappingRefreshDays, config.AnimeMappingUrl, cancellationToken, log);
                var index = AnimeMappingIndex.Load(mappingPath);
                log.Debug($"AniBridge 映射：{index.SourceDescriptors} 条来源描述，{index.IdentityLinks} 条身份映射");
                progress?.Report(15);

                var local = ScanLocalAnime(index, log);
                var seeds = local.SelectMany(x => x.AniListIds).Distinct().ToArray();
                var duplicates = AnimeCollectionPolicy.FindDuplicates(local);
                foreach (var duplicate in duplicates)
                    { log.Debug($"疑似重复媒体：{duplicate.Identifier}（{duplicate.EmbyIds.Count} 个项目）。仅提示，不会处理。"); log.Debug($"  重复媒体 {duplicate.Identifier} 的 Emby ID：{string.Join(", ", duplicate.EmbyIds)}"); }
                int recognized = local.Count(x => x.AniListIds.Count > 0);
                log.Info($"扫描 {local.Count} 个电影/剧集项目，已识别动漫 {recognized} 部，匹配 {seeds.Length} 条 AniList 记录。");
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

                var planned = AnimeGroupPlanner.Plan(local, graph.Records, config.AnimeIncludeSpinOffs);
                string ownershipPath = Path.Combine(dataDir, "owned-collections.json");
                if (File.Exists(ownershipPath))
                {
                    try
                    {
                        var prior = _json.DeserializeFromFile<AnimeCollectionState>(ownershipPath);
                        if (prior?.Collections != null)
                            AnimeCollectionPolicy.ApplyOwnershipSticky(planned, prior.Collections, msg => log.Info(msg));
                    }
                    catch { /* Invalid ownership is rejected later in SyncCollectionsAsync. */ }
                }
                var groups = policy.Apply(planned, local);
                var discarded = AnimeCollectionEditorSupport.ParseDiscardedKeys(config.AnimeDiscardedCollectionKeys);
                if (discarded.Count > 0)
                {
                    int before = groups.Count;
                    groups = groups.Where(g => g == null || string.IsNullOrEmpty(g.Key) || !discarded.Contains(g.Key)).ToList();
                    int removed = before - groups.Count;
                    if (removed > 0) log.Info($"已跳过 {removed} 个废弃合集。");
                }
                log.Info($"找到 {groups.Count} 个候选合集。");
                if (groups.Count == 0)
                {
                    LastStatus = "没有合集候选";
                    log.Skip("没有符合条件的候选合集，现有合集保持不变。");
                    await AnalyzeCollectionsAsync(config, local, graph.Records, groups, dataDir, cancellationToken, log);
                    WriteEmptyLastRunSummary(dataDir, config, dryRun, "没有合集候选");
                    return;
                }
                var nameById = local.Where(x => x.EmbyId > 0)
                    .GroupBy(x => x.EmbyId).ToDictionary(g => g.Key, g => g.First().Name ?? "");
                var localById = local.Where(x => x.EmbyId > 0)
                    .GroupBy(x => x.EmbyId).ToDictionary(g => g.Key, g => g.First());
                var syncResult = await SyncCollectionsAsync(groups, policy, dataDir, config, dryRun,
                    cancellationToken, log, progress, nameById, duplicates, localById);
                await AnalyzeCollectionsAsync(config, local, graph.Records, groups, dataDir, cancellationToken, log);
                EnrichRemindersFromAiAnalysis(dataDir, syncResult.Reminders, groups);
                SaveLastRunSummary(dataDir, config, syncResult);
                int writable = groups.Count(g => policy.CanWrite(g, dryRun));
                LastStatus = dryRun
                    ? $"仅预览：{groups.Count} 个候选"
                    : $"已完成：{writable} 个合集";
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
            // Emby merges multi-version movies under one UI row; alternate children still appear
            // in GetItemList — skip IDs listed by GetAlternateVersionIds on any Video.
            var alternateIds = new HashSet<long>();
            foreach (var media in all)
            {
                if (media is Video video)
                {
                    try
                    {
                        var linked = video.GetAlternateVersionIds();
                        if (linked == null) continue;
                        foreach (var id in linked)
                            if (id > 0) alternateIds.Add(id);
                    }
                    catch { /* Alternate API is best-effort; provider collapse still runs. */ }
                }
            }
            if (alternateIds.Count > 0)
                log.Debug($"Emby 已合并片源：跳过 {alternateIds.Count} 个附属版本条目。");
            var output = new List<AnimeLocalItem>();
            string topDir = Path.Combine(Plugin.Instance!.DataFolderPath, "toplists") + Path.DirectorySeparatorChar;
            foreach (var media in all)
            {
                if (media == null || media.InternalId <= 0 || media.IsVirtualItem ||
                    alternateIds.Contains(media.InternalId) ||
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
                // Direct AniList id on the item (plugin / metadata providers)
                foreach (var key in new[] { "AniList", "Anilist", "anilist" })
                {
                    var raw = media.GetProviderId(key);
                    if (string.IsNullOrWhiteSpace(raw)) continue;
                    if (int.TryParse(raw.Trim(), out var aid) && aid > 0) ids.Add(aid);
                }
                output.Add(new AnimeLocalItem
                {
                    EmbyId = media.InternalId,
                    Name = media.Name ?? "",
                    IsSeries = isSeries,
                    AniListIds = ids.OrderBy(id => id).ToList(),
                    ProviderIds = providerIds.OrderBy(id => id, StringComparer.Ordinal).ToList()
                });
                if (ids.Count > 0)
                    log.Debug($"  {media.Name}（Emby {media.InternalId}）→ AniList {string.Join("、", ids.OrderBy(id => id))}");
            }
            int beforeCollapse = output.Count;
            output = AnimeCollectionPolicy.CollapseProviderDuplicates(output);
            if (output.Count < beforeCollapse)
                log.Debug($"按片源标识合并重复条目：{beforeCollapse} → {output.Count}。");
            return output;
        }

        private async Task EnsureMappingsAsync(string path, int refreshDays, string? mappingUrl, CancellationToken token, RunLog log)
        {
            bool exists = File.Exists(path);
            if (exists && File.GetLastWriteTimeUtc(path) >= DateTime.UtcNow.AddDays(-Math.Max(1, refreshDays)))
                return;
            string url = string.IsNullOrWhiteSpace(mappingUrl) ? MappingUrl : mappingUrl.Trim();
            string tmp = path + ".download";
            Exception? last = null;
            for (int attempt = 1; attempt <= 3; attempt++)
            {
                try
                {
                    if (File.Exists(tmp)) File.Delete(tmp);
                    using (var remote = await _httpClient.Get(new HttpRequestOptions { Url = url, CancellationToken = token }))
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
                    return;
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    last = ex;
                    try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
                    if (attempt < 3)
                    {
                        log.Warn($"下载动漫映射失败（第 {attempt}/3 次）：{ex.Message}。稍后重试…");
                        await Task.Delay(TimeSpan.FromSeconds(2 * attempt), token);
                    }
                }
            }
            string hint =
                "无法更新动漫映射数据。请检查网络能否访问 GitHub，或在设置中填写可用的映射数据地址；" +
                "也可将 mappings.min.json 手动放到插件数据目录下的 anime/anibridge-v3.json。" +
                (last != null ? " 原因：" + last.Message : "");
            if (!exists) throw new InvalidOperationException(hint, last);
            throw new InvalidOperationException(hint + " 本地仍有旧映射，但本次已中止以免使用过期数据。", last);
        }

        private async Task<AnimeSyncRunResult> SyncCollectionsAsync(List<AnimeGroup> groups, AnimeCollectionPolicy policy,
            string dataDir, PluginConfiguration config, bool dryRun, CancellationToken token,
            RunLog log, IProgress<double>? progress, IReadOnlyDictionary<long, string> nameById,
            List<AnimeDuplicate> duplicates, IReadOnlyDictionary<long, AnimeLocalItem>? localById = null)
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
            int made = 0, updated = 0, collisions = 0, blocked = 0, unchanged = 0;
            var cards = new List<AnimeRunCard>();
            var reminders = new List<AnimeReminder>();
            var raisedUtc = DateTime.UtcNow.ToString("o");
            _ = duplicates; // retained for API shape; provider dups collapsed at scan
            var confirmedReassignments = new HashSet<long>(groups.Where(g => policy.CanWrite(g, false)).SelectMany(g => g.EmbyIds));
            // Detect splits against ALL candidates, including denied and review-blocked groups.
            // Filtering to the approved writer set first could strip a denied sibling's members.
            var splitIds = AnimeCollectionPolicy.FindSplitCollectionIds(groups, state.Collections);
            var visitedOwned = new HashSet<long>();
            for (int i = 0; i < groups.Count; i++)
            {
                token.ThrowIfCancellationRequested();
                var group = groups[i];
                var displayName = (config.AnimeCollectionPrefix ?? "动漫 · ") + group.Name;
                var block = policy.ExplainWriteBlock(group);
                if (block != null)
                {
                    log.Skip($"已跳过「{group.Name}」：{block}");
                    log.Debug($"跳过合集 {group.Key}");
                    LogMemberTitles(log, group, nameById);
                    var skipReason = HumanizeSkipReason(block);
                    cards.Add(MakeRunCard(group, displayName, "skipped", skipReason, nameById, localById));
                    reminders.Add(MakeReminder("cannot_write", group.Key, displayName, skipReason, raisedUtc));
                    blocked++;
                    continue;
                }
                if (group.ReviewRequired && !group.HasExplicitRule)
                {
                    log.Debug($"[{group.Key}] {group.Name}: branch present; writing automatic grouping (member rules can override)");
                    reminders.Add(MakeReminder("branch", group.Key, displayName,
                        "这个系列有多条续作线，自动归类可能偏宽，建议之后核对成员。", raisedUtc));
                }
                // Provider duplicates are collapsed at scan time; no user-facing duplicate reminders.
                bool mayWrite = policy.CanWrite(group, dryRun);
                var desired = new HashSet<long>(group.EmbyIds);
                var matches = state.Collections.Where(c => c.Anchor == group.Anchor || c.ManagedItemIds.Any(desired.Contains)).ToList();
                if (matches.Count > 1)
                {
                    string reason = "与多个由插件管理的合集重叠，请人工检查。";
                    log.Warn($"已跳过「{group.Name}」：{reason}");
                    log.Debug($"跳过合集 {group.Key}");
                    LogMemberTitles(log, group, nameById);
                    cards.Add(MakeRunCard(group, displayName, "skipped", reason, nameById, localById));
                    reminders.Add(MakeReminder("cannot_write", group.Key, displayName, reason, raisedUtc));
                    collisions++;
                    continue;
                }
                var owned = matches.Count == 1 ? matches[0] : null;
                if (owned != null && (splitIds.Contains(owned.CollectionId) || !visitedOwned.Add(owned.CollectionId)))
                {
                    string reason = "原合集已拆分成多个分组，请人工检查。";
                    log.Warn($"已跳过「{group.Name}」：{reason}");
                    log.Debug($"跳过合集 {group.Key}");
                    LogMemberTitles(log, group, nameById);
                    cards.Add(MakeRunCard(group, displayName, "skipped", reason, nameById, localById));
                    reminders.Add(MakeReminder("cannot_write", group.Key, displayName, reason, raisedUtc));
                    collisions++;
                    continue;
                }
                BaseItem? box = owned == null ? null : existing.FirstOrDefault(x => x.InternalId == owned.CollectionId);
                var name = displayName;
                var nameMatches = existing.Where(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase))
                    .Select(x => x.InternalId).ToList();

                // Ownership points at a collection that no longer exists: drop the row and allow recreate.
                if (owned != null && box == null)
                {
                    log.Warn($"归属记录中的合集（ID {owned.CollectionId} / 作品编号 {owned.Anchor}）已不存在，已清除记录。符合写入条件时将按新建处理。");
                    state.Collections.Remove(owned);
                    SaveState(stateFile, state);
                    owned = null;
                }

                if (!AnimeCollectionPolicy.CanUseIdentity(owned?.CollectionId, box?.InternalId, nameMatches))
                {
                    string reason = owned == null && nameMatches.Count > 0
                        ? "和已有合集重名，为避免改动手工合集已跳过。可先在 Emby 中重命名或删除后再同步。"
                        : "原合集已不存在，或名称与其他合集重复。手工合集不会被改动。";
                    if (owned == null && nameMatches.Count > 0)
                    {
                        log.Warn($"已跳过「{name}」：存在同名合集且无有效归属，已跳过以免改动手工合集。若确认为旧插件合集，请先在 Emby 中重命名或删除后再运行。");
                        log.Debug($"跳过合集 {group.Key}");
                    }
                    else
                    {
                        log.Warn($"已跳过「{name}」：原合集已不存在，或名称与其他合集重复。手工创建的合集不会被改动。");
                        log.Debug($"跳过合集 {group.Key}");
                    }
                    LogMemberTitles(log, group, nameById);
                    cards.Add(MakeRunCard(group, name, "skipped", reason, nameById, localById));
                    reminders.Add(MakeReminder("cannot_write", group.Key, name, reason, raisedUtc));
                    collisions++;
                    continue;
                }
                if (owned == null)
                {
                    log.Info($"{(mayWrite ? "创建" : "预计创建")}「{name}」（{desired.Count} 部）。");
                    log.Debug($"合集 {group.Key}");
                    LogMemberTitles(log, group, nameById);
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
                    cards.Add(MakeRunCard(group, name, mayWrite ? "created" : "will_create", "", nameById, localById));
                    made++;
                }
                else
                {
                    var cardName = box!.Name ?? name;
                    if (!string.Equals(box!.Name, name, StringComparison.Ordinal))
                    {
                        log.Info($"保留现有合集名称「{box.Name}」；别名「{name}」只在新建合集时使用。");
                        log.Debug($"合集 {group.Key}");
                    }
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
                        string reason = "无法从此合集移除成员。";
                        log.Warn($"已跳过「{cardName}」：{reason}");
                        log.Debug($"跳过合集 {group.Key}");
                        LogMemberTitles(log, group, nameById);
                        cards.Add(MakeRunCard(group, cardName, "skipped", reason, nameById, localById));
                        reminders.Add(MakeReminder("cannot_write", group.Key, cardName, reason, raisedUtc));
                        collisions++;
                        continue;
                    }
                    if (toAdd.Length > 0 || toRemove.Length > 0)
                    {
                        log.Info($"{(mayWrite ? "更新" : "预计更新")}「{box.Name}」：+{toAdd.Length}，-{toRemove.Length}。");
                        log.Debug($"合集 {group.Key}");
                        LogMemberTitles(log, group, nameById);
                        if (mayWrite)
                        {
                            if (toAdd.Length > 0) await _collections.AddToCollection(box.InternalId, toAdd);
                            if (toRemove.Length > 0) _collections.RemoveFromCollection((BoxSet)box, toRemove);
                        }
                        cards.Add(MakeRunCard(group, cardName, mayWrite ? "updated" : "will_update", "", nameById, localById));
                        updated++;
                    }
                    else
                    {
                        LogMemberTitles(log, group, nameById);
                        cards.Add(MakeRunCard(group, cardName, "unchanged", "", nameById, localById));
                        unchanged++;
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
            int skipped = collisions + blocked;
            log.Ok($"{(dryRun ? "仅预览" : "已完成")}：新建 {made} 个，更新 {updated} 个，冲突 {collisions} 个，跳过 {blocked} 个。");
            log.Debug("不会删除合集，也不会移除手工添加的成员。");
            return new AnimeSyncRunResult
            {
                DryRun = dryRun,
                Made = made,
                Updated = updated,
                Skipped = skipped,
                Unchanged = unchanged,
                Cards = cards,
                Reminders = reminders,
                State = state,
                Existing = existing
            };
        }


        private void WriteEmptyLastRunSummary(string dataDir, PluginConfiguration config, bool dryRun, string statusText)
        {
            try
            {
                var owned = LoadOwnedCards(dataDir, null);
                var reminders = new List<AnimeReminder>();
                EnrichRemindersFromAiAnalysis(dataDir, reminders, null);
                reminders = MergeHandledReminders(dataDir, reminders);
                int open = reminders.Count(r => !r.Handled);
                MarkOwnedReminderFlags(owned, reminders);
                var summary = new AnimeLastRunSummary
                {
                    DryRun = dryRun,
                    GlobalDryRun = config.DryRunMode,
                    FinishedUtc = DateTime.UtcNow.ToString("o"),
                    StatusText = statusText ?? "",
                    Reminders = open,
                    Owned = owned,
                    ReminderItems = reminders
                };
                WriteSummaryFile(dataDir, summary);
            }
            catch { }
        }

        private void SaveLastRunSummary(string dataDir, PluginConfiguration config, AnimeSyncRunResult run)
        {
            var reminders = MergeHandledReminders(dataDir, run.Reminders ?? new List<AnimeReminder>());
            var ownedCards = BuildOwnedCards(run.State, run.Existing);
            var openKeys = new HashSet<string>(
                reminders.Where(r => r != null && !r.Handled && !string.IsNullOrEmpty(r.CollectionKey))
                    .Select(r => r.CollectionKey),
                StringComparer.Ordinal);
            foreach (var card in run.Cards ?? new List<AnimeRunCard>())
                if (card != null) card.HasReminder = openKeys.Contains(card.Key ?? "");
            MarkOwnedReminderFlags(ownedCards, reminders);
            int open = reminders.Count(r => !r.Handled);
            string baseStatus = run.DryRun
                ? $"预览：将新建 {run.Made} · 将更新 {run.Updated} · 跳过 {run.Skipped}"
                : $"完成：新建 {run.Made} · 更新 {run.Updated} · 跳过 {run.Skipped}";
            var summary = new AnimeLastRunSummary
            {
                DryRun = run.DryRun,
                GlobalDryRun = config.DryRunMode,
                FinishedUtc = DateTime.UtcNow.ToString("o"),
                StatusText = baseStatus,
                Created = run.Made,
                Updated = run.Updated,
                Skipped = run.Skipped,
                Unchanged = run.Unchanged,
                Reminders = open,
                Cards = run.Cards ?? new List<AnimeRunCard>(),
                Owned = ownedCards,
                ReminderItems = reminders
            };
            try { WriteSummaryFile(dataDir, summary); }
            catch
            {
                // Card UI is best-effort; never fail the sync because summary write failed.
            }
        }

        private void WriteSummaryFile(string dataDir, AnimeLastRunSummary summary)
        {
            Directory.CreateDirectory(dataDir);
            var pathFile = Path.Combine(dataDir, "last-run-summary.json");
            var textOut = _json.SerializeToString(summary);
            var tmp = pathFile + ".tmp";
            File.WriteAllText(tmp, textOut, Encoding.UTF8);
            if (File.Exists(pathFile)) File.Replace(tmp, pathFile, null);
            else File.Move(tmp, pathFile);
        }

        private List<AnimeOwnedCard> LoadOwnedCards(string dataDir, List<BaseItem>? existing)
        {
            AnimeCollectionState? state = null;
            string stateFile = Path.Combine(dataDir, "owned-collections.json");
            if (File.Exists(stateFile))
            {
                try { state = _json.DeserializeFromFile<AnimeCollectionState>(stateFile); } catch { }
            }
            return BuildOwnedCards(state, existing);
        }

        private static List<AnimeOwnedCard> BuildOwnedCards(AnimeCollectionState? state, List<BaseItem>? existing)
        {
            var ownedCards = new List<AnimeOwnedCard>();
            if (state?.Collections == null) return ownedCards;
            foreach (var c in state.Collections)
            {
                if (c == null || c.CollectionId <= 0) continue;
                var box = existing?.FirstOrDefault(x => x.InternalId == c.CollectionId);
                ownedCards.Add(new AnimeOwnedCard
                {
                    CollectionId = c.CollectionId,
                    Key = c.Anchor > 0 ? ("anilist:" + c.Anchor.ToString(System.Globalization.CultureInfo.InvariantCulture)) : "",
                    Name = box?.Name ?? c.Name ?? "",
                    MemberCount = c.ManagedItemIds?.Count ?? 0
                });
            }
            return ownedCards;
        }

        private static void MarkOwnedReminderFlags(List<AnimeOwnedCard> owned, List<AnimeReminder> reminders)
        {
            if (owned == null || reminders == null) return;
            var openNames = new HashSet<string>(
                reminders.Where(r => r != null && !r.Handled && !string.IsNullOrWhiteSpace(r.CollectionName))
                    .Select(r => r.CollectionName.Trim()),
                StringComparer.OrdinalIgnoreCase);
            foreach (var o in owned)
                if (o != null) o.HasReminder = !string.IsNullOrWhiteSpace(o.Name) && openNames.Contains(o.Name.Trim());
        }

        private List<AnimeReminder> MergeHandledReminders(string dataDir, List<AnimeReminder> fresh)
        {
            var previous = new Dictionary<string, AnimeReminder>(StringComparer.Ordinal);
            try
            {
                var pathFile = Path.Combine(dataDir, "last-run-summary.json");
                if (File.Exists(pathFile))
                {
                    var prior = _json.DeserializeFromFile<AnimeLastRunSummary>(pathFile);
                    if (prior?.ReminderItems != null)
                    {
                        foreach (var item in prior.ReminderItems)
                        {
                            if (item == null || string.IsNullOrWhiteSpace(item.Id)) continue;
                            previous[item.Id] = item;
                        }
                    }
                }
            }
            catch { }

            var byId = new Dictionary<string, AnimeReminder>(StringComparer.Ordinal);
            foreach (var item in fresh ?? new List<AnimeReminder>())
            {
                if (item == null || string.IsNullOrWhiteSpace(item.Id)) continue;
                if (previous.TryGetValue(item.Id, out var old))
                {
                    if (old.Handled) item.Handled = true;
                    if (string.IsNullOrWhiteSpace(item.SuggestedName) && !string.IsNullOrWhiteSpace(old.SuggestedName))
                        item.SuggestedName = old.SuggestedName;
                }
                byId[item.Id] = item;
            }
            return byId.Values.OrderBy(r => r.CollectionName, StringComparer.OrdinalIgnoreCase)
                .ThenBy(r => r.TypeLabel, StringComparer.OrdinalIgnoreCase)
                .ThenBy(r => r.Id, StringComparer.Ordinal)
                .ToList();
        }

        private void EnrichRemindersFromAiAnalysis(string dataDir, List<AnimeReminder> reminders, List<AnimeGroup>? groups)
        {
            if (reminders == null) return;
            AnimeAiAnalysis analysis;
            try { analysis = new AnimeAiAnalysisService(_json).Read(dataDir); }
            catch { return; }
            if (analysis?.Suggestions == null || analysis.Suggestions.Count == 0) return;

            var nameByKey = new Dictionary<string, string>(StringComparer.Ordinal);
            if (groups != null)
            {
                foreach (var g in groups)
                {
                    if (g == null || string.IsNullOrEmpty(g.Key)) continue;
                    nameByKey[g.Key] = g.Name ?? "";
                }
            }
            foreach (var rem in reminders)
            {
                if (rem == null || string.IsNullOrEmpty(rem.CollectionKey)) continue;
                if (!string.IsNullOrWhiteSpace(rem.CollectionName))
                    nameByKey[rem.CollectionKey] = rem.CollectionName;
            }

            string raisedUtc = DateTime.UtcNow.ToString("o");
            var existingIds = new HashSet<string>(reminders.Where(r => r != null).Select(r => r.Id), StringComparer.Ordinal);

            foreach (var suggestion in analysis.Suggestions)
            {
                if (suggestion == null || string.IsNullOrWhiteSpace(suggestion.GroupKey)) continue;
                string key = suggestion.GroupKey.Trim();
                string display = nameByKey.TryGetValue(key, out var n) && !string.IsNullOrWhiteSpace(n)
                    ? n
                    : (string.IsNullOrWhiteSpace(suggestion.OriginalName) ? key : suggestion.OriginalName);

                if (suggestion.ReviewIssues != null)
                {
                    int idx = 0;
                    foreach (var issue in suggestion.ReviewIssues)
                    {
                        if (issue == null) continue;
                        string type = MapAiIssueType(issue.IssueType);
                        if (type == null) continue;
                        // Branch already covered by ReviewRequired during sync — keep one.
                        string id = type == "branch"
                            ? ReminderId(type, key)
                            : ReminderId(type, key) + "|" + idx.ToString();
                        idx++;
                        if (!existingIds.Add(id)) continue;
                        string reason = string.IsNullOrWhiteSpace(issue.Reason)
                            ? ReminderTypeLabel(type)
                            : issue.Reason.Trim();
                        reminders.Add(MakeReminderWithId(id, type, key, display, reason, raisedUtc));
                    }
                }

                if (string.Equals(suggestion.Kind, "naming", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(suggestion.Decision, "suggest", StringComparison.OrdinalIgnoreCase))
                {
                    if (!string.IsNullOrWhiteSpace(suggestion.SuggestedName) &&
                        !string.Equals(suggestion.SuggestedName.Trim(), display, StringComparison.OrdinalIgnoreCase))
                    {
                        string id = ReminderId("naming", key);
                        if (existingIds.Add(id))
                        {
                            string suggested = suggestion.SuggestedName.Trim();
                            string reason = "建议改用「" + suggested + "」。"
                                + (string.IsNullOrWhiteSpace(suggestion.Reason) ? "" : " " + suggestion.Reason.Trim());
                            var namingReminder = MakeReminderWithId(id, "naming", key, display, reason.Trim(), raisedUtc);
                            namingReminder.SuggestedName = suggested;
                            reminders.Add(namingReminder);
                        }
                    }
                }
            }
        }

        private static string? MapAiIssueType(string? issueType)
        {
            if (string.IsNullOrWhiteSpace(issueType)) return null;
            switch (issueType.Trim().ToLowerInvariant())
            {
                case "branch": return "branch";
                case "cross_ip": return "cross_ip";
                case "duplicate": return "duplicate";
                case "naming": return "naming";
                case "missing_local": return "missing_local";
                default: return null;
            }
        }

        private static Dictionary<long, List<AnimeDuplicate>> BuildDuplicateLookup(List<AnimeDuplicate>? duplicates)
        {
            var map = new Dictionary<long, List<AnimeDuplicate>>();
            if (duplicates == null) return map;
            foreach (var dup in duplicates)
            {
                if (dup?.EmbyIds == null || dup.EmbyIds.Count < 2) continue;
                foreach (var id in dup.EmbyIds)
                {
                    if (!map.TryGetValue(id, out var list))
                    {
                        list = new List<AnimeDuplicate>();
                        map[id] = list;
                    }
                    list.Add(dup);
                }
            }
            return map;
        }

        private static void AddDuplicateReminders(List<AnimeReminder> reminders, AnimeGroup group, string displayName,
            Dictionary<long, List<AnimeDuplicate>> duplicateByEmby, string raisedUtc)
        {
            if (group?.EmbyIds == null || duplicateByEmby == null || duplicateByEmby.Count == 0) return;
            var hits = new List<AnimeDuplicate>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var embyId in group.EmbyIds)
            {
                if (!duplicateByEmby.TryGetValue(embyId, out var list)) continue;
                foreach (var dup in list)
                {
                    if (dup == null || string.IsNullOrWhiteSpace(dup.Identifier)) continue;
                    if (!seen.Add(dup.Identifier)) continue;
                    // Only when at least two of this group's members share the identity.
                    int inGroup = dup.EmbyIds.Count(id => group.EmbyIds.Contains(id));
                    if (inGroup >= 2) hits.Add(dup);
                }
            }
            if (hits.Count == 0) return;
            string reason = "同一部作品有多份片源（" + string.Join("、", hits.Select(h => h.Identifier).Take(3))
                + (hits.Count > 3 ? "…" : "") + "）。只提示，不会自动删片。";
            reminders.Add(MakeReminder("duplicate", group.Key, displayName, reason, raisedUtc));
        }

        private static AnimeReminder MakeReminder(string type, string collectionKey, string collectionName,
            string reason, string raisedUtc)
        {
            return MakeReminderWithId(ReminderId(type, collectionKey), type, collectionKey, collectionName, reason, raisedUtc);
        }

        private static AnimeReminder MakeReminderWithId(string id, string type, string collectionKey,
            string collectionName, string reason, string raisedUtc)
        {
            return new AnimeReminder
            {
                Id = id,
                CollectionKey = collectionKey ?? "",
                CollectionName = collectionName ?? "",
                Type = type ?? "",
                TypeLabel = ReminderTypeLabel(type),
                Reason = reason ?? "",
                Handled = false,
                RaisedUtc = raisedUtc ?? ""
            };
        }

        private static string ReminderId(string type, string collectionKey) =>
            (type ?? "") + "|" + (collectionKey ?? "");

        /// <summary>Human labels for reminder types (main UI — no jargon).</summary>
        internal static string ReminderTypeLabel(string? type)
        {
            switch ((type ?? "").Trim().ToLowerInvariant())
            {
                case "branch": return "系列结构复杂";
                case "cross_ip": return "可能混进其它作品";
                case "duplicate": return "片源重复";
                case "naming": return "名称不太合适";
                case "missing_local": return "库里可能还缺";
                case "cannot_write": return "没法写入";
                default: return "需要留意";
            }
        }

        private static AnimeRunCard MakeRunCard(AnimeGroup group, string displayName, string status,
            string reason, IReadOnlyDictionary<long, string> nameById,
            IReadOnlyDictionary<long, AnimeLocalItem>? localById = null)
        {
            const int previewCap = 6;
            var titles = MemberTitleList(group, nameById);
            var includeIds = MemberIncludeIdList(group, localById);
            return new AnimeRunCard
            {
                Key = group.Key,
                Name = displayName,
                Status = status,
                Reason = reason ?? "",
                MemberCount = titles.Count,
                MemberTitles = titles.Take(previewCap).ToList(),
                MemberIncludeIds = includeIds.Take(previewCap).ToList(),
                MoreCount = Math.Max(0, titles.Count - previewCap)
            };
        }

        private static List<string> MemberIncludeIdList(AnimeGroup group,
            IReadOnlyDictionary<long, AnimeLocalItem>? localById)
        {
            var ids = new List<string>();
            if (group?.EmbyIds == null) return ids;
            foreach (var embyId in group.EmbyIds)
            {
                if (localById != null && localById.TryGetValue(embyId, out var item))
                {
                    var primary = AnimeCollectionEditorSupport.PrimaryIncludeId(item);
                    if (!string.IsNullOrEmpty(primary)) ids.Add(primary);
                    else ids.Add("");
                }
                else ids.Add("");
            }
            return ids;
        }

        private static List<string> MemberTitleList(AnimeGroup group, IReadOnlyDictionary<long, string> nameById)
        {
            var titles = new List<string>();
            foreach (var id in group.EmbyIds)
            {
                if (nameById != null && nameById.TryGetValue(id, out var n) && !string.IsNullOrWhiteSpace(n))
                    titles.Add(n.Trim());
                else
                    titles.Add("未命名项目");
            }
            return titles;
        }

        /// <summary>Map policy/internal skip text to card UI wording (no jargon on the main path).</summary>
        private static string HumanizeSkipReason(string? reason)
        {
            if (string.IsNullOrWhiteSpace(reason)) return "";
            if (reason.IndexOf("成员不足", StringComparison.Ordinal) >= 0)
                return "成员不足两部。";
            return reason.Trim();
        }

        private static void LogMemberTitles(RunLog log, AnimeGroup group, IReadOnlyDictionary<long, string> nameById)
        {
            var titles = MemberTitleList(group, nameById);
            const int cap = 20;
            string line = titles.Count <= cap
                ? string.Join("、", titles)
                : string.Join("、", titles.Take(cap)) + "… 另有 " + (titles.Count - cap) + " 部";
            log.Detail("成员：" + line);
            log.Debug($"  [{group.Key}] 成员 Emby ID：{string.Join(", ", group.EmbyIds)}");
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
