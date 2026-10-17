using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Querying;
using MediaBrowser.Model.Tasks;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace HomeScreenCompanion
{
    public class MergeTopListVersionsTask : IScheduledTask
    {
        private readonly ILibraryManager _libraryManager;
        private readonly IProviderManager _providerManager;
        private readonly IFileSystem _fileSystem;

        public static List<string> ExecutionLog { get; } = new List<string>();
        public static bool IsRunning { get; private set; } = false;
        private static RunLog _log = new RunLog(ExecutionLog, null, "", false);
        public static string LastRunStatus { get; private set; } = "Never";

        private readonly ILogger _logger;

        public MergeTopListVersionsTask(ILibraryManager libraryManager, IProviderManager providerManager, IFileSystem fileSystem, ILogManager logManager)
        {
            _libraryManager = libraryManager;
            _providerManager = providerManager;
            _fileSystem = fileSystem;
            _logger = logManager.GetLogger("HomeScreenCompanion_TopListMerge");
        }

        // Forces Emby to ffprobe a top-list .strm item so it gets a real RunTimeTicks and
        // MediaStreams. Without this, freshly indexed .strm items have RunTimeTicks = 0, which
        // makes Emby mark the movie fully played (instead of saving a resume point) when stopped
        // mid-playback from the top-list. EnableRemoteContentProbe is the flag that makes the
        // server probe .strm targets (they are skipped during a normal library scan).
        internal static void QueueStrmProbe(IProviderManager providerManager, IFileSystem fileSystem, BaseItem li)
        {
            if (providerManager == null || fileSystem == null || li == null) return;
            // Already has a real runtime → nothing to fix. Makes this safe to call repeatedly
            // (e.g. from the post-creation poll loop) without re-probing healthy items.
            if ((li.RunTimeTicks ?? 0) > 0) return;
            try
            {
                var opts = new MetadataRefreshOptions(fileSystem)
                {
                    MetadataRefreshMode      = MetadataRefreshMode.FullRefresh,
                    EnableRemoteContentProbe = true,
                    ImageRefreshMode         = MetadataRefreshMode.ValidationOnly, // keep our ranked posters
                    ReplaceAllImages         = false,
                    ForceSave                = true
                };
                providerManager.QueueRefresh(li.InternalId, opts, RefreshPriority.High);
            }
            catch { }
        }

        public string Key => "MergeTopListVersionsTask";
        public string Name => "合并榜单与媒体库版本";
        public string Description => "将榜单 .strm 项目关联为对应媒体库电影的其他版本（如 1080p/4K），避免界面重复显示；启用合集同步时，也会同步其合集归属。请在媒体库扫描并索引新增榜单项目后运行。";
        public string Category => "首页助手";

        public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => Array.Empty<TaskTriggerInfo>();

        public Task Execute(CancellationToken cancellationToken, IProgress<double> progress)
        {
            IsRunning = true;
            lock (ExecutionLog) { ExecutionLog.Clear(); }
            var startTime = DateTime.Now;
            _log = new RunLog(ExecutionLog, _logger, "[榜单合并]", Plugin.Instance?.Configuration?.ExtendedConsoleOutput ?? false);
            try
            {
                _log.Info($"» 合并榜单与媒体库版本  ·  {startTime:yyyy-MM-dd HH:mm}");
                var merged = MergeAll(_libraryManager, _providerManager, _fileSystem, cancellationToken);
                // Bring collection memberships of all copies in line with the setting (mirror or clear).
                var collChanges = TopListCollectionMirror.SyncAll(cancellationToken).GetAwaiter().GetResult();
                LastRunStatus = $"Done — 已关联 {merged} 个项目。";
                _log.Ok($"已将 {RunLog.Plural(merged, "个榜单项目")} 关联到媒体库电影  ·  {RunLog.Elapsed(DateTime.Now - startTime)}");
                if (collChanges > 0)
                    _log.Ok($"已更新榜单项目的 {RunLog.Plural(collChanges, "项合集归属")}");
            }
            catch (Exception ex)
            {
                LastRunStatus = $"Error: {ex.Message}";
                _log.Error($"合并已中止：{ex.Message}");
            }
            finally
            {
                IsRunning = false;
            }
            return Task.CompletedTask;
        }

        internal static int MergeAll(ILibraryManager libraryManager, IProviderManager providerManager, IFileSystem fileSystem, CancellationToken cancellationToken)
        {
            var dataPath = Plugin.Instance?.DataFolderPath;
            if (string.IsNullOrEmpty(dataPath)) return 0;

            var topListsFolder = Path.Combine(dataPath, "toplists") + Path.DirectorySeparatorChar;
            if (!Directory.Exists(topListsFolder.TrimEnd(Path.DirectorySeparatorChar))) return 0;

            // Build IMDb → original movie lookup (non-strm items only)
            var origLookup = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);
            foreach (var m in libraryManager.GetItemList(new InternalItemsQuery
            {
                IncludeItemTypes = new[] { "Movie" },
                Recursive = true,
                IsVirtualItem = false
            }))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (string.IsNullOrEmpty(m.Path)) continue;
                if (m.Path.StartsWith(topListsFolder, StringComparison.OrdinalIgnoreCase)) continue;
                var imdb = m.GetProviderId("Imdb");
                if (!string.IsNullOrEmpty(imdb) && !origLookup.ContainsKey(imdb))
                    origLookup[imdb] = m;
            }

            _log.Debug($"  媒体库中有 {origLookup.Count:N0} 部电影带有 IMDb ID");

            // Find all indexed STRM items living under any top-list subfolder
            var strmItems = libraryManager.GetItemList(new InternalItemsQuery
            {
                IncludeItemTypes = new[] { "Movie" },
                Recursive = true,
                IsVirtualItem = false
            }).Where(i => !string.IsNullOrEmpty(i.Path)
                       && i.Path.StartsWith(topListsFolder, StringComparison.OrdinalIgnoreCase))
              .ToList();

            _log.Debug($"  找到 {strmItems.Count} 个已索引的榜单项目");

            int merged = 0;

            foreach (var li in strmItems)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var imdb = li.GetProviderId("Imdb");
                if (string.IsNullOrEmpty(imdb)) continue;
                if (!origLookup.TryGetValue(imdb, out var primary)) continue;
                if (li.Id == primary.Id) continue;

                try
                {
                    libraryManager.MergeItems(new[] { primary, li });
                    QueueStrmProbe(providerManager, fileSystem, li);
                    merged++;
                    _log.Debug($"  已将“{li.Name}”关联到“{primary.Name}”");
                }
                catch (Exception ex)
                {
                    _log.Warn($"无法将“{li.Name}”关联到“{primary.Name}”：{ex.Message}");
                }
            }

            return merged;
        }

        // Merges + probes only the STRM items living under a single top-list folder.
        // Used right after a top-list is created (post library-scan) so RunTimeTicks is filled in
        // automatically without waiting for the daily task. Returns how many STRM items are indexed
        // under the folder and how many were mergeable, so the caller can poll until the async scan
        // has fully indexed the new items.
        internal static (int indexed, int merged) MergeAndProbeFolder(
            ILibraryManager libraryManager, IProviderManager providerManager, IFileSystem fileSystem,
            string folderPath, CancellationToken cancellationToken)
        {
            if (string.IsNullOrEmpty(folderPath)) return (0, 0);
            var folderPrefix = folderPath.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;

            var dataPath = Plugin.Instance?.DataFolderPath;
            var topListsFolder = string.IsNullOrEmpty(dataPath)
                ? null
                : Path.Combine(dataPath, "toplists") + Path.DirectorySeparatorChar;

            var allMovies = libraryManager.GetItemList(new InternalItemsQuery
            {
                IncludeItemTypes = new[] { "Movie" },
                Recursive = true,
                IsVirtualItem = false
            });

            // IMDb → original (non-strm) movie lookup
            var origLookup = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);
            foreach (var m in allMovies)
            {
                if (string.IsNullOrEmpty(m.Path)) continue;
                if (topListsFolder != null && m.Path.StartsWith(topListsFolder, StringComparison.OrdinalIgnoreCase)) continue;
                var imdb = m.GetProviderId("Imdb");
                if (!string.IsNullOrEmpty(imdb) && !origLookup.ContainsKey(imdb))
                    origLookup[imdb] = m;
            }

            var strmItems = allMovies
                .Where(i => !string.IsNullOrEmpty(i.Path)
                         && i.Path.StartsWith(folderPrefix, StringComparison.OrdinalIgnoreCase))
                .ToList();

            int merged = 0;
            foreach (var li in strmItems)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var imdb = li.GetProviderId("Imdb");
                if (string.IsNullOrEmpty(imdb)) continue;
                if (!origLookup.TryGetValue(imdb, out var primary)) continue;
                if (li.Id == primary.Id) continue;
                try
                {
                    libraryManager.MergeItems(new[] { primary, li });
                    QueueStrmProbe(providerManager, fileSystem, li);
                    merged++;
                }
                catch { }
            }

            return (strmItems.Count, merged);
        }
    }
}
