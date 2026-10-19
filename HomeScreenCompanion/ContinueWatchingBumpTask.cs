using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Tasks;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace HomeScreenCompanion
{
    /// <summary>
    /// Scheduled catch-up for the Continue Watching bump: re-checks every series that received
    /// episodes recently. Safe to run often — ContinueWatchingBumper is idempotent.
    /// </summary>
    public class ContinueWatchingBumpTask : IScheduledTask
    {
        private const int LookbackDays = 14;

        private readonly ILibraryManager _libraryManager;
        private readonly IUserManager _userManager;
        private readonly IUserDataManager _userDataManager;
        private readonly ILogger _logger;

        public static List<string> ExecutionLog { get; } = new List<string>();

        public ContinueWatchingBumpTask(ILibraryManager libraryManager, IUserManager userManager, IUserDataManager userDataManager, ILogManager logManager)
        {
            _libraryManager = libraryManager;
            _userManager = userManager;
            _userDataManager = userDataManager;
            _logger = logManager.GetLogger("HomeScreenCompanion_CWBump");
        }

        public string Key => "ContinueWatchingBumpTask";
        public string Name => "继续观看置顶";
        public string Description => "已看完的剧集有新集上线时，将其移至“继续观看”前列。";
        public string Category => "Home Screen Companion 动漫版";

        public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
        {
            return new[]
            {
                new TaskTriggerInfo { Type = TaskTriggerInfo.TriggerInterval, IntervalTicks = TimeSpan.FromHours(6).Ticks }
            };
        }

        public Task Execute(CancellationToken cancellationToken, IProgress<double> progress)
        {
            lock (ExecutionLog) { ExecutionLog.Clear(); }

            var config = Plugin.Instance?.Configuration;
            if (config == null) return Task.CompletedTask;

            var log = new RunLog(ExecutionLog, _logger, "[CW Bump]", config.ExtendedConsoleOutput);
            log.Rule();
            log.Info($"继续观看置顶  ·  {DateTime.Now:yyyy-MM-dd HH:mm}");
            log.Rule();

            if (!config.ContinueWatchingBumpEnabled)
            {
                log.Skip("设置中未启用继续观看置顶，无需处理");
                return Task.CompletedTask;
            }

            var users = ContinueWatchingBumper.ResolveUsers(config, _userManager);
            if (users.Count == 0)
            {
                log.Warn("设置中未选择用户，无需处理");
                return Task.CompletedTask;
            }

            var seriesIds = _libraryManager.GetItemList(new InternalItemsQuery
            {
                IncludeItemTypes = new[] { "Episode" },
                Recursive = true,
                IsVirtualItem = false,
                MinDateCreated = DateTimeOffset.UtcNow.AddDays(-LookbackDays)
            })
            .OfType<Episode>()
            .Select(e => e.SeriesId)
            .Where(id => id > 0)
            .Distinct()
            .ToList();

            log.Info($"  最近 {LookbackDays} 天内有新集入库的剧集：{RunLog.Plural(seriesIds.Count, "部剧集")}  ·  {RunLog.Plural(users.Count, "位用户")}");

            int bumped = 0;
            for (int i = 0; i < seriesIds.Count; i++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (_libraryManager.GetItemById(seriesIds[i]) is Series series)
                    bumped += ContinueWatchingBumper.ProcessSeries(series, users, config, _libraryManager, _userDataManager, log, cancellationToken);
                progress.Report(100.0 * (i + 1) / seriesIds.Count);
            }

            if (bumped == 0) log.Skip("没有需要置顶的剧集");
            else log.Ok($"已完成 {RunLog.Plural(bumped, "次置顶")}");
            return Task.CompletedTask;
        }
    }
}
