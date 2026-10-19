using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Tasks;
using MediaBrowser.Model.Users;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;

namespace HomeScreenCompanion
{
    public class HomeSectionSyncTask : IScheduledTask
    {
        private readonly IUserManager _userManager;
        private readonly ILogger _logger;

        public static string LastSyncTime { get; private set; } = "Never";
        public static bool IsRunning { get; private set; } = false;
        public static string LastSyncResult { get; private set; } = "";
        public static int LastSectionsCopied { get; private set; } = 0;
        public static List<string> ExecutionLog { get; } = new List<string>();
        public static DateTime? LastStartedUtc { get; private set; }
        private RunLog _log;

        private static void PersistLog() => LogStore.Save(LogStore.HomeScreen, ExecutionLog, LastSyncResult, LastStartedUtc,
            new Dictionary<string, string>
            {
                ["LastSyncTime"] = LastSyncTime,
                ["SectionsCopied"] = LastSectionsCopied.ToString(System.Globalization.CultureInfo.InvariantCulture)
            });

        // Brings back the last run's log and status after a server restart.
        internal static void RestoreLog()
        {
            var saved = LogStore.Load(LogStore.HomeScreen);
            if (saved == null || IsRunning) return;
            lock (ExecutionLog)
            {
                if (ExecutionLog.Count > 0) return;
                ExecutionLog.AddRange(saved.Lines ?? new List<string>());
            }
            LastSyncResult = LogStore.RestoredStatus(saved.Status);
            LastStartedUtc = saved.StartedUtc;
            var extra = saved.Extra ?? new Dictionary<string, string>();
            if (extra.TryGetValue("LastSyncTime", out var t) && !string.IsNullOrEmpty(t)) LastSyncTime = t;
            if (extra.TryGetValue("SectionsCopied", out var c) && int.TryParse(c, out var n)) LastSectionsCopied = n;
        }

        public HomeSectionSyncTask(IUserManager userManager, ILogManager logManager)
        {
            _userManager = userManager;
            _logger = logManager.GetLogger("HomeScreenCompanion_HSC");
            _log = new RunLog(ExecutionLog, _logger, "[Home Screen]", false);
        }

        public string Key => "HomeSectionSyncTask";
        public string Name => "首页同步";
        public string Description => "将来源用户的首页栏目同步到所有选定的目标用户。";
        public string Category => "Home Screen Companion";

        public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
        {
            return Array.Empty<TaskTriggerInfo>();
        }

        public Task Execute(CancellationToken cancellationToken, IProgress<double> progress)
        {
            IsRunning = true;
            lock (ExecutionLog) { ExecutionLog.Clear(); }
            LastStartedUtc = DateTime.UtcNow;
            try
            {
                var config = Plugin.Instance?.Configuration;
                if (config == null) return Task.CompletedTask;

                bool debug = config.ExtendedConsoleOutput;
                _log = new RunLog(ExecutionLog, _logger, "[Home Screen]", debug);
                var startTime = DateTime.Now;
                _log.Rule();
                _log.Info($"首页同步  ·  {startTime:yyyy-MM-dd HH:mm}");
                _log.Rule();

                if (!config.HomeSyncEnabled)
                {
                    _log.Skip("设置中未启用首页同步 — 无需操作");
                    return Task.CompletedTask;
                }

                if (string.IsNullOrWhiteSpace(config.HomeSyncSourceUserId))
                {
                    _log.Warn("设置中未选择来源用户 — 无可同步内容");
                    LastSyncResult = "未配置来源用户。";
                    return Task.CompletedTask;
                }

                if (config.HomeSyncTargetUserIds == null || config.HomeSyncTargetUserIds.Count == 0)
                {
                    _log.Warn("设置中未选择目标用户 — 无可同步内容");
                    LastSyncResult = "未配置目标用户。";
                    return Task.CompletedTask;
                }

                var sourceInternalId = _userManager.GetInternalId(config.HomeSyncSourceUserId);
                string sourceName = Guid.TryParse(config.HomeSyncSourceUserId, out var srcGuid)
                    ? (_userManager.GetUserById(srcGuid)?.Name ?? config.HomeSyncSourceUserId)
                    : config.HomeSyncSourceUserId;
                progress.Report(5);

                var sourceSections = _userManager.GetHomeSections(sourceInternalId, cancellationToken);

                if (sourceSections?.Sections == null || sourceSections.Sections.Length == 0)
                {
                    _log.Warn($"来源用户 {sourceName} 没有首页栏目 — 无可复制内容");
                    LastSyncResult = "来源用户没有首页栏目。";
                    return Task.CompletedTask;
                }

                _log.Info($"  来源用户： {sourceName}  ·  {RunLog.Plural(sourceSections.Sections.Length, "个栏目")}");
                _log.Section("来源用户的栏目");
                foreach (var s in sourceSections.Sections)
                    _log.Debug($"  [{s.SectionType}] \"{s.CustomName ?? s.Name}\"");

                progress.Report(20);
                int totalCopied = 0, failedUsers = 0;
                int targetCount = config.HomeSyncTargetUserIds.Count;
                _log.Blank();
                _log.Info("» 复制首页");

                for (int i = 0; i < targetCount; i++)
                {
                    cancellationToken.ThrowIfCancellationRequested();

                    var targetIdStr = config.HomeSyncTargetUserIds[i];
                    string targetName = Guid.TryParse(targetIdStr, out var tgtGuid)
                        ? (_userManager.GetUserById(tgtGuid)?.Name ?? targetIdStr)
                        : targetIdStr;
                    try
                    {
                        var targetInternalId = _userManager.GetInternalId(targetIdStr);

                        var existing = _userManager.GetHomeSections(targetInternalId, cancellationToken);
                        if (existing?.Sections?.Length > 0)
                        {
                            _log.Debug($"  {targetName}: 正在替换 {existing.Sections.Length} 个现有栏目");
                            var idsToDelete = existing.Sections
                                .Where(s => !string.IsNullOrEmpty(s.Id))
                                .Select(s => s.Id)
                                .ToArray();
                            if (idsToDelete.Length > 0)
                                _userManager.DeleteHomeSections(targetInternalId, idsToDelete, cancellationToken);
                        }

                        foreach (var section in sourceSections.Sections)
                        {
                            _log.Debug($"  {targetName}: + [{section.SectionType}] \"{section.CustomName ?? section.Name}\"");
                            _userManager.AddHomeSection(targetInternalId, CopySection(section), cancellationToken);
                            totalCopied++;
                        }

                        _log.Ok($"{targetName}: {RunLog.Plural(sourceSections.Sections.Length, "个栏目")} 已复制");
                    }
                    catch (Exception ex)
                    {
                        failedUsers++;
                        _log.Error($"{targetName}: 无法复制首页 — {ex.Message}");
                    }

                    progress.Report(20 + (int)(80.0 * (i + 1) / targetCount));
                }

                if (config.HomeSyncLibraryOrder)
                {
                    _log.Blank();
                    _log.Info("» 媒体库顺序");
                    try
                    {
                        var sourceUser = _userManager.GetUserById(config.HomeSyncSourceUserId);
                        if (sourceUser != null)
                        {
                            var sourceConf = _userManager.GetUserConfiguration(sourceUser);
                            if (sourceConf?.OrderedViews != null && sourceConf.OrderedViews.Length > 0)
                            {
                                _log.Debug($"  来源用户顺序： [{string.Join(", ", sourceConf.OrderedViews)}]");
                                foreach (var targetIdStr in config.HomeSyncTargetUserIds)
                                {
                                    string targetName2 = Guid.TryParse(targetIdStr, out var tgtGuid2)
                                        ? (_userManager.GetUserById(tgtGuid2)?.Name ?? targetIdStr)
                                        : targetIdStr;
                                    try
                                    {
                                        var targetUser = _userManager.GetUserById(targetIdStr);
                                        if (targetUser == null) continue;
                                        var targetConf = _userManager.GetUserConfiguration(targetUser);
                                        if (targetConf == null) continue;
                                        targetConf.OrderedViews = sourceConf.OrderedViews;
                                        _userManager.UpdateConfiguration(_userManager.GetInternalId(targetIdStr), targetConf);
                                        _log.Ok($"{targetName2}: 已复制媒体库顺序");
                                    }
                                    catch (Exception ex)
                                    {
                                        _log.Warn($"{targetName2}: 无法复制媒体库顺序 — {ex.Message}");
                                    }
                                }
                            }
                            else
                            {
                                _log.Skip($"{sourceName} 未自定义媒体库顺序 — 无可复制内容");
                            }
                        }
                        else
                        {
                            _log.Warn("无法加载来源用户 — 未复制媒体库顺序");
                        }
                    }
                    catch (Exception ex)
                    {
                        _log.Error($"媒体库顺序同步失败： {ex.Message}");
                    }
                }

                LastSectionsCopied = totalCopied;
                LastSyncTime = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
                LastSyncResult = $"成功 — 已将 {totalCopied} 个栏目复制到 {targetCount} 位用户。";
                _log.Rule();
                _log.Info("汇总");
                _log.Info($"  栏目：      {totalCopied} 已复制到 {RunLog.Plural(targetCount - failedUsers, "位用户")}{(failedUsers > 0 ? $", {RunLog.Plural(failedUsers, "位用户")} 失败" : "")}");
                _log.Info($"  完成，耗时 {RunLog.Elapsed(DateTime.Now - startTime)}  ·  {(failedUsers > 0 ? "✖ 已完成，有 " + RunLog.Plural(failedUsers, "个错误") : "✔ 已完成")}");
                _log.Rule();
                progress.Report(100);
            }
            catch (OperationCanceledException)
            {
                LastSyncResult = "已取消。";
                _log.Warn("同步已取消");
            }
            catch (Exception ex)
            {
                LastSyncResult = $"错误： {ex.Message}";
                _log.Error($"同步已中止： {ex.Message}");
            }
            finally
            {
                IsRunning = false;
                PersistLog();
            }

            return Task.CompletedTask;
        }

        private static ContentSection CopySection(ContentSection source)
        {
            var copy = new ContentSection();
            foreach (var prop in typeof(ContentSection).GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (prop.Name == "Id") continue;
                if (prop.CanRead && prop.CanWrite)
                    prop.SetValue(copy, prop.GetValue(source));
            }
            return copy;
        }
    }
}
