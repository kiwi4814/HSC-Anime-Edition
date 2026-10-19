using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using MediaBrowser.Model.Drawing;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace HomeScreenCompanion
{
    public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages, IHasThumbImage
    {
        public override string Name => "Home Screen Companion Anime Edition";

        public override Guid Id => new Guid("b5bca829-e903-4af4-9fb2-451d72a487e6");

        public override string Description => "为 Emby 自动添加标签、维护合集和同步主屏幕，并按作品系列整理动漫合集。";

        public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
            : base(applicationPaths, xmlSerializer)
        {
            Instance = this;
            AppPaths = applicationPaths;
            XmlSerializer = xmlSerializer;
        }

        public static Plugin? Instance { get; private set; }
        public static IApplicationPaths AppPaths { get; private set; } = null!;
        public static new IXmlSerializer XmlSerializer { get; private set; } = null!;

        public override void UpdateConfiguration(BasePluginConfiguration configuration)
        {
            var wasMirroring = Configuration?.TopListMirrorCollections ?? false;
            base.UpdateConfiguration(configuration);
            // Toggling the collection mirror adds (or removes) memberships for all existing copies.
            if (Configuration.TopListMirrorCollections != wasMirroring)
                TopListCollectionMirror.QueueFullSync();
        }

        public IEnumerable<PluginPageInfo> GetPages()
        {
            var assembly = GetType().Assembly;

            var htmlPath = assembly.GetManifestResourceNames().FirstOrDefault(r => r.EndsWith("configPage.html"));
            var jsPath = assembly.GetManifestResourceNames().FirstOrDefault(r => r.EndsWith("configPage.js"));

            if (htmlPath == null || jsPath == null)
            {
                return new List<PluginPageInfo>();
            }

            return new[]
            {
                new PluginPageInfo
                {
                    Name = "HomeScreenCompanionAnimeEdition",
                    EmbeddedResourcePath = htmlPath,

                    EnableInMainMenu = true,
                    DisplayName = "HSC Anime Edition",
                    MenuIcon = "home"
                },
                new PluginPageInfo
                {
                    Name = "HomeScreenCompanionAnimeEditionJS",
                    EmbeddedResourcePath = jsPath
                }
            };
        }

        public Stream GetThumbImage()
        {
            var type = GetType();
            var thumbPath = type.Assembly.GetManifestResourceNames().FirstOrDefault(r => r.EndsWith("thumb.png"));
            return (thumbPath != null ? type.Assembly.GetManifestResourceStream(thumbPath) : Stream.Null) ?? Stream.Null;
        }

        public ImageFormat ThumbImageFormat => ImageFormat.Png;
    }
}