using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace HomeScreenCompanion
{
    internal sealed class AnimeGraphResult
    {
        public List<AnimeRelationRecord> Records { get; set; } = new List<AnimeRelationRecord>();
        public int NetworkRequests { get; set; }
        public bool Complete { get; set; }
        /// <summary>"" when complete; "budget" when request quota exhausted; "node_limit" when hard cap hit.</summary>
        public string IncompleteReason { get; set; } = "";
    }

    // The traversal is independent of HTTP/Emby so its write-safety gate can be tested offline.
    internal static class AnimeGraphExpansion
    {
        internal static async Task<AnimeGraphResult> ExpandAsync(IEnumerable<int> seeds, int requestBudget,
            int graphNodeLimit, int cacheDays, bool includeSpinOffs,
            Dictionary<int, AnimeRelationRecord> cache,
            Func<int, CancellationToken, Task<AnimeRelationRecord>> fetch, Action save,
            CancellationToken cancellationToken, Action<string> onProgress)
        {
            var result = new AnimeGraphResult();
            var toVisit = new Queue<(int Id, int Depth)>();
            var queued = new HashSet<int>();
            foreach (var id in seeds.Where(i => i > 0).Distinct())
                if (queued.Add(id)) toVisit.Enqueue((id, 0));
            if (queued.Count == 0) { result.Complete = true; return result; }
            bool dirty = false;
            try
            {
                while (toVisit.Count > 0)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (queued.Count > graphNodeLimit)
                    {
                        result.IncompleteReason = "node_limit";
                        onProgress("作品关系数量已达上限（" + graphNodeLimit + "），本次未修改任何合集。");
                        break;
                    }
                    var node = toVisit.Dequeue();
                    if (!cache.TryGetValue(node.Id, out var record) ||
                        record.FetchedUtc < DateTime.UtcNow.AddDays(-Math.Max(1, cacheDays)))
                    {
                        if (result.NetworkRequests >= requestBudget)
                        {
                            result.IncompleteReason = "budget";
                            onProgress("已达到本次 AniList 请求上限（" + requestBudget + "），请再次运行任务以继续获取。");
                            // The dequeued node is still unresolved, even if it was the last
                            // queued node. Never let an empty queue turn this into Complete.
                            return result;
                        }
                        if (result.NetworkRequests > 0) await Task.Delay(2100, cancellationToken);
                        record = await fetch(node.Id, cancellationToken);
                        cache[node.Id] = record;
                        dirty = true;
                        result.NetworkRequests++;
                        if (result.NetworkRequests % 12 == 0)
                        {
                            save();
                            onProgress($"AniList：已获取 {result.NetworkRequests} 份作品关系");
                        }
                    }
                    result.Records.Add(record);
                    if (node.Depth >= 2) continue;
                    foreach (var edge in record.Relations)
                        if (edge.Id > 0 && edge.Type == "ANIME" &&
                            AnimeGroupPlanner.IsSafeRelation(edge.Relation, includeSpinOffs) &&
                            queued.Add(edge.Id))
                            toVisit.Enqueue((edge.Id, node.Depth + 1));
                }
                result.Complete = toVisit.Count == 0 && result.IncompleteReason.Length == 0;
                return result;
            }
            finally
            {
                if (dirty) save();
            }
        }
    }
}
