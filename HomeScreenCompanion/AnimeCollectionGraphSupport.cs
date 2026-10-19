using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace HomeScreenCompanion
{
    /// <summary>
    /// Read-only collection relation subgraph + plain-language edge labels (P3).
    /// Layout is a simple layered tree (story order), not a force simulation.
    /// </summary>
    internal static class AnimeCollectionGraphSupport
    {
        internal const int MaxNodes = 80;

        internal sealed class GraphNode
        {
            public int AniListId { get; set; }
            public string IncludeId { get; set; } = "";
            public string Title { get; set; } = "";
            public bool InLibrary { get; set; }
            public bool InCollection { get; set; }
            public double X { get; set; }
            public double Y { get; set; }
        }

        internal sealed class GraphEdge
        {
            public int From { get; set; }
            public int To { get; set; }
            /// <summary>Raw relation token (SEQUEL/…); UI should prefer Label.</summary>
            public string Relation { get; set; } = "";
            public string Label { get; set; } = "";
        }

        internal sealed class GraphSubgraph
        {
            public List<GraphNode> Nodes { get; set; } = new List<GraphNode>();
            public List<GraphEdge> Edges { get; set; } = new List<GraphEdge>();
            public bool Truncated { get; set; }
            public double Width { get; set; }
            public double Height { get; set; }
        }

        /// <summary>Human-readable edge label for the main path (no English enums).</summary>
        internal static string RelationLabelZh(string? relation)
        {
            switch ((relation ?? "").Trim().ToUpperInvariant())
            {
                case "SEQUEL": return "续作";
                case "PREQUEL": return "前传";
                case "SIDE_STORY": return "外传";
                case "PARENT": return "母作品";
                case "SPIN_OFF": return "衍生";
                case "ALTERNATIVE":
                case "ALTERNATIVE_VERSION": return "另一版本";
                case "ADAPTATION": return "改编";
                case "CHARACTER": return "角色相关";
                case "SUMMARY": return "总集篇";
                case "OTHER": return "相关";
                default:
                    var raw = (relation ?? "").Trim();
                    return string.IsNullOrEmpty(raw) ? "相关" : "相关";
            }
        }

        /// <summary>
        /// Build the connected subgraph around a seed AniList id using cached relation records.
        /// <paramref name="libraryTitles"/> maps AniList id → local title when present.
        /// <paramref name="collectionAniListIds"/> marks nodes already in the current collection selection.
        /// </summary>
        internal static GraphSubgraph Build(
            int seedAniListId,
            IEnumerable<AnimeRelationRecord> records,
            IReadOnlyDictionary<int, string> libraryTitles,
            IReadOnlyCollection<int> collectionAniListIds,
            bool includeSpinOffs)
        {
            var subgraph = new GraphSubgraph();
            if (seedAniListId <= 0) return subgraph;

            var byId = new Dictionary<int, AnimeRelationRecord>();
            foreach (var r in records ?? Array.Empty<AnimeRelationRecord>())
            {
                if (r == null || r.Id <= 0) continue;
                byId[r.Id] = r;
            }

            var library = libraryTitles ?? new Dictionary<int, string>();
            var selected = new HashSet<int>(collectionAniListIds ?? Array.Empty<int>());

            // Adjacency of display edges (both endpoints known after walk).
            var walkQueue = new Queue<int>();
            var visited = new HashSet<int>();
            walkQueue.Enqueue(seedAniListId);
            visited.Add(seedAniListId);

            var edgeKeys = new HashSet<string>(StringComparer.Ordinal);
            var edges = new List<GraphEdge>();
            var titles = new Dictionary<int, string>();

            void RememberTitle(int id, string? name)
            {
                if (id <= 0 || string.IsNullOrWhiteSpace(name)) return;
                if (!titles.ContainsKey(id)) titles[id] = name.Trim();
            }

            if (byId.TryGetValue(seedAniListId, out var seedRec))
                RememberTitle(seedAniListId, seedRec.Name);

            while (walkQueue.Count > 0 && visited.Count < MaxNodes)
            {
                int id = walkQueue.Dequeue();
                if (!byId.TryGetValue(id, out var record)) continue;
                RememberTitle(id, record.Name);
                foreach (var rel in record.Relations ?? new List<AnimeRelation>())
                {
                    if (rel == null || rel.Id <= 0) continue;
                    if (!string.Equals(rel.Type, "ANIME", StringComparison.OrdinalIgnoreCase)) continue;
                    var kind = (rel.Relation ?? "").Trim().ToUpperInvariant();
                    // Show the same continuity set the planner uses; also surface alternative versions for readability.
                    bool show = AnimeGroupPlanner.IsSafeRelation(kind, includeSpinOffs)
                        || kind == "ALTERNATIVE" || kind == "ALTERNATIVE_VERSION";
                    if (!show) continue;

                    RememberTitle(rel.Id, rel.Name);
                    string key = id.ToString(CultureInfo.InvariantCulture) + ">" +
                                 rel.Id.ToString(CultureInfo.InvariantCulture) + ">" + kind;
                    if (edgeKeys.Add(key))
                    {
                        edges.Add(new GraphEdge
                        {
                            From = id,
                            To = rel.Id,
                            Relation = kind,
                            Label = RelationLabelZh(kind)
                        });
                    }

                    if (visited.Count >= MaxNodes) break;
                    if (AnimeGroupPlanner.IsSafeRelation(kind, includeSpinOffs) && visited.Add(rel.Id))
                        walkQueue.Enqueue(rel.Id);
                }
            }

            bool truncated = walkQueue.Count > 0 || visited.Count >= MaxNodes;

            // Ensure every edge endpoint that we kept an edge for is represented if under cap.
            foreach (var e in edges)
            {
                if (visited.Count >= MaxNodes) break;
                visited.Add(e.From);
                if (visited.Count >= MaxNodes) break;
                visited.Add(e.To);
            }

            // Drop edges whose endpoints were not retained.
            edges = edges.Where(e => visited.Contains(e.From) && visited.Contains(e.To)).ToList();

            var layers = AssignLayers(visited, edges);
            var lanes = AssignLanes(visited, edges, layers);

            const double xGap = 200;
            const double yGap = 78;
            const double pad = 28;
            double maxX = 0, maxY = 0;
            var nodes = new List<GraphNode>();
            foreach (var id in visited.OrderBy(i => layers.TryGetValue(i, out var L) ? L : 0).ThenBy(i => i))
            {
                int layer = layers.TryGetValue(id, out var L) ? L : 0;
                int lane = lanes.TryGetValue(id, out var laneVal) ? laneVal : 0;
                double x = pad + layer * xGap;
                double y = pad + lane * yGap;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;

                string title;
                if (library.TryGetValue(id, out var libTitle) && !string.IsNullOrWhiteSpace(libTitle))
                    title = libTitle.Trim();
                else if (titles.TryGetValue(id, out var cached) && !string.IsNullOrWhiteSpace(cached))
                    title = cached;
                else
                    title = "未命名作品";

                bool inLib = library.ContainsKey(id);
                nodes.Add(new GraphNode
                {
                    AniListId = id,
                    IncludeId = "anilist:" + id.ToString(CultureInfo.InvariantCulture),
                    Title = title,
                    InLibrary = inLib,
                    InCollection = selected.Contains(id),
                    X = x,
                    Y = y
                });
            }

            subgraph.Nodes = nodes;
            subgraph.Edges = edges;
            subgraph.Truncated = truncated;
            subgraph.Width = maxX + 180 + pad;
            subgraph.Height = maxY + 64 + pad;
            if (subgraph.Width < 320) subgraph.Width = 320;
            if (subgraph.Height < 120) subgraph.Height = 120;
            return subgraph;
        }

        /// <summary>Story-order layers: SEQUEL advances depth; PREQUEL reverses.</summary>
        private static Dictionary<int, int> AssignLayers(HashSet<int> nodes, List<GraphEdge> edges)
        {
            var storySucc = new Dictionary<int, List<int>>();
            var storyPred = new Dictionary<int, List<int>>();
            void Add(Dictionary<int, List<int>> map, int from, int to)
            {
                if (!map.TryGetValue(from, out var list)) map[from] = list = new List<int>();
                if (!list.Contains(to)) list.Add(to);
            }

            foreach (var e in edges)
            {
                var kind = (e.Relation ?? "").ToUpperInvariant();
                if (kind == "SEQUEL")
                {
                    Add(storySucc, e.From, e.To);
                    Add(storyPred, e.To, e.From);
                }
                else if (kind == "PREQUEL")
                {
                    // A -PREQUEL→ B means B is earlier → story B → A
                    Add(storySucc, e.To, e.From);
                    Add(storyPred, e.From, e.To);
                }
            }

            var layer = new Dictionary<int, int>();
            var roots = nodes.Where(n => !storyPred.ContainsKey(n) || storyPred[n].Count == 0).OrderBy(n => n).ToList();
            if (roots.Count == 0) roots = nodes.OrderBy(n => n).Take(1).ToList();

            var q = new Queue<int>();
            foreach (var r in roots)
            {
                layer[r] = 0;
                q.Enqueue(r);
            }
            while (q.Count > 0)
            {
                int cur = q.Dequeue();
                int curLayer = layer[cur];
                if (!storySucc.TryGetValue(cur, out var next)) continue;
                foreach (var n in next)
                {
                    if (!nodes.Contains(n)) continue;
                    int candidate = curLayer + 1;
                    if (!layer.TryGetValue(n, out var existing) || candidate > existing)
                    {
                        layer[n] = candidate;
                        q.Enqueue(n);
                    }
                }
            }

            // Nodes only linked via side/spin/parent: place near a connected layered node.
            foreach (var n in nodes)
            {
                if (layer.ContainsKey(n)) continue;
                int best = 0;
                foreach (var e in edges)
                {
                    if (e.From == n && layer.TryGetValue(e.To, out var lt)) best = Math.Max(best, lt);
                    if (e.To == n && layer.TryGetValue(e.From, out var lf)) best = Math.Max(best, lf);
                }
                layer[n] = best;
            }

            foreach (var n in nodes)
                if (!layer.ContainsKey(n)) layer[n] = 0;
            return layer;
        }

        private static Dictionary<int, int> AssignLanes(
            HashSet<int> nodes, List<GraphEdge> edges, Dictionary<int, int> layers)
        {
            var byLayer = nodes.GroupBy(n => layers.TryGetValue(n, out var L) ? L : 0)
                .ToDictionary(g => g.Key, g => g.OrderBy(id => id).ToList());

            // Prefer keeping sequels of the same parent in adjacent lanes.
            var parentOf = new Dictionary<int, int>();
            foreach (var e in edges)
            {
                var kind = (e.Relation ?? "").ToUpperInvariant();
                int earlier, later;
                if (kind == "SEQUEL") { earlier = e.From; later = e.To; }
                else if (kind == "PREQUEL") { earlier = e.To; later = e.From; }
                else continue;
                if (!parentOf.ContainsKey(later)) parentOf[later] = earlier;
            }

            var lane = new Dictionary<int, int>();
            int globalLaneCursor = 0;
            foreach (var layerKey in byLayer.Keys.OrderBy(k => k))
            {
                var list = byLayer[layerKey];
                // Stable: sort by parent's lane then id
                list = list.OrderBy(id =>
                {
                    if (parentOf.TryGetValue(id, out var p) && lane.TryGetValue(p, out var pl)) return pl;
                    return int.MaxValue / 4;
                }).ThenBy(id => id).ToList();

                int local = 0;
                foreach (var id in list)
                {
                    if (parentOf.TryGetValue(id, out var p) && lane.TryGetValue(p, out var pl))
                        lane[id] = pl + local; // branch offset
                    else
                        lane[id] = globalLaneCursor + local;
                    local++;
                }
                if (list.Count > 0)
                    globalLaneCursor = Math.Max(globalLaneCursor, list.Max(id => lane[id]) + 1);
            }

            // Compact lanes to 0..n-1 without gaps for display height.
            var used = lane.Values.Distinct().OrderBy(v => v).ToList();
            var remap = used.Select((v, i) => (v, i)).ToDictionary(x => x.v, x => x.i);
            foreach (var id in nodes.ToList())
            {
                if (!lane.TryGetValue(id, out var raw)) lane[id] = 0;
                else lane[id] = remap[raw];
            }
            return lane;
        }

        /// <summary>Parse anilist:N keys / include ids into positive AniList ids.</summary>
        internal static List<int> ParseAniListIds(IEnumerable<string?> ids)
        {
            var result = new List<int>();
            var seen = new HashSet<int>();
            foreach (var raw in ids ?? Array.Empty<string?>())
            {
                var s = (raw ?? "").Trim();
                if (!s.StartsWith("anilist:", StringComparison.Ordinal)) continue;
                if (!int.TryParse(s.Substring(8), NumberStyles.None, CultureInfo.InvariantCulture, out var id)) continue;
                if (id <= 0) continue;
                if (seen.Add(id)) result.Add(id);
            }
            return result;
        }
    }
}
