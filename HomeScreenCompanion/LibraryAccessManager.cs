using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Model.Logging;
using System;
using System.Threading.Tasks;

namespace HomeScreenCompanion
{
    public class LibraryAccessManager : IServerEntryPoint
    {
        private readonly ILibraryManager _libraryManager;
        private readonly IUserManager _userManager;
        private readonly ILogger _logger;

        public LibraryAccessManager(
            ILibraryManager libraryManager,
            IUserManager userManager,
            ILogManager logManager)
        {
            _libraryManager = libraryManager;
            _userManager = userManager;
            _logger = logManager.GetLogger("HomeScreenCompanion_LibraryAccess");
        }

        public void Run()
        {
            _libraryManager.ItemAdded += OnItemAdded;
        }

        public void Dispose()
        {
            _libraryManager.ItemAdded -= OnItemAdded;
        }

        private void OnItemAdded(object sender, ItemChangeEventArgs e)
        {
            if (!(e.Item is CollectionFolder)) return;

            var libName = e.Item.Name;
            _logger.Info($"[媒体库访问权限] 检测到新媒体库“{libName}”（内部 ID={e.Item.InternalId}）。将在 30 秒后同步访问权限，等待 Emby 异步策略恢复完成……");

            // Emby runs an async policy restoration after library creation.
            // We wait 30 seconds to ensure Emby has finished before we apply
            // our selective grant/revoke logic.
            Task.Delay(30000).ContinueWith(_ =>
            {
                var config = Plugin.Instance?.Configuration;
                if (config?.TopLists == null || config.TopLists.Count == 0) return;
                try
                {
                    TopListSyncTask.GrantTopListLibraryAccess(config.TopLists, _userManager, _libraryManager, _logger);
                }
                catch (Exception ex)
                {
                    _logger.Error($"[媒体库访问权限] 访问权限同步失败：{ex.GetBaseException().Message}");
                }
            });
        }
    }
}
