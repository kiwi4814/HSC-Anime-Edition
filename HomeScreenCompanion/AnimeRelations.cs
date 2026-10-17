using System;
using System.Collections.Generic;
using System.Linq;

namespace HomeScreenCompanion
{
    internal sealed class AnimeLocalItem
    {
        public long EmbyId { get; set; }
        public string Name { get; set; } = "";
        public bool IsSeries { get; set; }
        public List<int> AniListIds { get; set; } = new List<int>();
        public List<string> ProviderIds { get; set; } = new List<string>();
    }

    internal sealed class AnimeRelation
    {
        public int Id { get; set; }
        public string Relation { get; set; } = "";
        public string Name { get; set; } = "";
        public string Type { get; set; } = "";
    }

    internal sealed class AnimeRelationRecord
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public DateTime FetchedUtc { get; set; }
        public List<AnimeRelation> Relations { get; set; } = new List<AnimeRelation>();
    }

    internal sealed class AnimeGroup
    {
        public int Anchor { get; set; }
        private string? _key;
        public string Key { get => _key ?? "anilist:" + Anchor.ToString(System.Globalization.CultureInfo.InvariantCulture); set => _key = value; }
        public bool ReviewRequired { get; set; }
        public bool HasExplicitRule { get; set; }
        public string Name { get; set; } = "";
        public List<long> EmbyIds { get; set; } = new List<long>();
    }

    internal sealed class AnimeAiDecisionCache
    {
        public Dictionary<string, AnimeAiDecisionEntry> Decisions { get; set; } =
            new Dictionary<string, AnimeAiDecisionEntry>();
    }

    internal sealed class AnimeAiDecisionEntry
    {
        public bool Approved { get; set; }
        public DateTime CheckedUtc { get; set; }
    }

    internal static class AnimeGroupPlanner
    {
        private sealed class UnionFind
        {
            private readonly Dictionary<int, int> _parents = new Dictionary<int, int>();
            public int Find(int key)
            {
                if (!_parents.TryGetValue(key, out var parent)) { _parents[key] = key; return key; }
                if (parent == key) return key;
                return _parents[key] = Find(parent);
            }
            public void Join(int a, int b)
            {
                var x = Find(a); var y = Find(b);
                if (x != y) _parents[Math.Max(x, y)] = Math.Min(x, y);
            }
        }

        /// <summary>
        /// Only story continuity/spinoff edges connect franchises. Similar, character,
        /// adaptation, alternative-version and generic OTHER links do not imply same IP.
        /// </summary>
        public static bool IsSafeRelation(string relation, bool includeSpinOffs)
        {
            switch ((relation ?? "").Trim().ToUpperInvariant())
            {
                case "SEQUEL": case "PREQUEL": case "SIDE_STORY": case "PARENT": return true;
                case "SPIN_OFF": return includeSpinOffs;
                default: return false;
            }
        }

        public static List<AnimeGroup> Plan(
            IEnumerable<AnimeLocalItem> source,
            IEnumerable<AnimeRelationRecord> relations,
            bool includeSpinOffs)
        {
            var local = source.Where(i => i.EmbyId > 0 && i.AniListIds.Count > 0).ToList();
            var records = relations.ToList();
            var branchIds = new HashSet<int>();
            var continuity = new HashSet<(int From, int To)>();
            var uf = new UnionFind();
            foreach (var item in local)
            {
                var ids = item.AniListIds.Distinct().Where(id => id > 0).ToList();
                if (ids.Count == 0) continue;
                uf.Find(ids[0]);
                // A single Emby item may represent several AniList entries (TV seasons,
                // films containing multiple shorts, etc). Keep that item in one group.
                foreach (var id in ids.Skip(1)) uf.Join(ids[0], id);
            }
            foreach (var record in records)
            {
                foreach (var edge in record.Relations)
                {
                    if (edge.Id <= 0 || edge.Type != "ANIME") continue;
                    var relation = (edge.Relation ?? "").Trim().ToUpperInvariant();
                    if (relation == "SPIN_OFF" || relation == "SIDE_STORY" || relation == "PARENT" ||
                        relation == "ALTERNATIVE" || relation == "ALTERNATIVE_VERSION")
                    {
                        // Disabled SPIN_OFF edges still reveal a branch; excluding an edge
                        // from connectivity does not establish strict mainline membership.
                        branchIds.Add(record.Id);
                        branchIds.Add(edge.Id);
                    }
                    if (relation == "SEQUEL") continuity.Add((record.Id, edge.Id));
                    if (relation == "PREQUEL") continuity.Add((edge.Id, record.Id));
                    if (IsSafeRelation(relation, includeSpinOffs))
                        uf.Join(record.Id, edge.Id);
                }
            }
            foreach (var fork in continuity.GroupBy(e => e.From).Where(g => g.Count() > 1))
            {
                branchIds.Add(fork.Key);
                foreach (var edge in fork) branchIds.Add(edge.To);
            }
            foreach (var fork in continuity.GroupBy(e => e.To).Where(g => g.Count() > 1))
            {
                branchIds.Add(fork.Key);
                foreach (var edge in fork) branchIds.Add(edge.From);
            }
            var branchRoots = new HashSet<int>(branchIds.Select(uf.Find));
            var components = local.SelectMany(i => i.AniListIds.Select(id => new { id, item = i }))
                .Where(x => x.id > 0)
                .GroupBy(x => uf.Find(x.id))
                .Select(g => new
                {
                    Anchor = g.Select(x => x.id).Min(),
                    Items = g.Select(x => x.item).GroupBy(x => x.EmbyId).Select(x => x.First()).ToList()
                })
                .Where(g => g.Items.Count >= 2)
                .OrderBy(g => g.Anchor).ToList();

            return components.Select(g => new AnimeGroup
            {
                Anchor = g.Anchor,
                EmbyIds = g.Items.Select(i => i.EmbyId).OrderBy(id => id).ToList(),
                Name = ChooseName(g.Items),
                ReviewRequired = g.Items.SelectMany(i => i.AniListIds).Any(id => branchRoots.Contains(uf.Find(id)))
            }).ToList();
        }

        internal static string ChooseName(List<AnimeLocalItem> items)
        {
            var candidates = items.OrderByDescending(i => i.IsSeries)
                .Select(i => (i.Name ?? "").Trim()).Where(s => s.Length >= 2)
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (candidates.Count == 0) return "未命名动漫";
            var shortest = candidates.OrderBy(s => s.Length).ThenBy(s => s, StringComparer.Ordinal).First();
            // Use an existing Chinese title if available, otherwise an existing original title;
            // never ask an LLM to invent the IP name.
            var cn = candidates.Where(s => s.Any(c => c >= '\u3400' && c <= '\u9fff'))
                .OrderBy(s => s.Length).FirstOrDefault();
            var family = cn != null
                ? candidates.Where(s => s.Any(c => c >= '\u3400' && c <= '\u9fff')).ToList()
                : candidates;
            if (family.Count >= 2)
            {
                var common = family[0];
                foreach (var title in family.Skip(1))
                {
                    int chars = 0;
                    while (chars < common.Length && chars < title.Length &&
                           char.ToUpperInvariant(common[chars]) == char.ToUpperInvariant(title[chars])) chars++;
                    common = common.Substring(0, chars);
                }
                common = common.TrimEnd(' ', '：', ':', '/', '-', '—', '·', '.', '(', '（');
                if (common.Length >= (cn == null ? 4 : 2)) return common;
            }
            return cn ?? shortest;
        }
    }
}
