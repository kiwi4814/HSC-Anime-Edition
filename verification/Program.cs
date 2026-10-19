using System.Text.Json;
using System.Xml.Serialization;
using HomeScreenCompanion;

// Every title/provider ID in this harness is synthetic. No production library or network is read.
static partial class Program
{
    private static int _passed;
    const int A = 1900000101, B = 1900000102, C = 1900000103, D = 1900000104;
    const string Key = "anilist:1900000101";
    const string Rules = """
        [{"Key":"anilist:1900000101","IncludeIds":["anilist:1900000101","tmdb_show:1900000202","anilist:1900000103"],"ExcludeIds":["tmdb_show:1900000203"]}]
        """;

    static int Main(string[] args)
    {
        try
        {
            if (args.SequenceEqual(new[] { "--preview-demo" })) { PrintPreviewDemo(); return 0; }
            TestMappings();
            TestGroups();
            TestAnchorGraphMinAndSticky();
            TestOwnership();
            TestGraphExpansion().GetAwaiter().GetResult();
            TestDuplicates();
            TestExactMembership();
            TestAliasesAndApproval();
            TestCollectionEditorRewrite();
            TestCollectionGraphSubgraph();
            TestInvalidPolicies();
            TestLegacyStateAndCache();
            TestConfigurationCompatibility();
            TestPreviewCases();
            TestAiHttpAndAnalysis().GetAwaiter().GetResult();
            Console.WriteLine($"PASS: {_passed} assertions; fictional fixtures and localhost HTTP only");
            return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine("FAIL: " + ex); return 1; }
    }

    static void Assert(bool result, string name)
    {
        if (!result) throw new Exception(name);
        _passed++;
    }

    static void Reject(Action action, string name)
    {
        bool rejected = false;
        try { action(); } catch (InvalidDataException) { rejected = true; }
        Assert(rejected, name);
    }

    static AnimeLocalItem Item(long id, string name, bool series, int aniListId, params string[] providers) =>
        new() { EmbyId = id, Name = name, IsSeries = series,
            AniListIds = aniListId > 0 ? new() { aniListId } : new(), ProviderIds = providers.ToList() };

    static AnimeRelationRecord Relation(int from, int to, string kind = "SEQUEL") =>
        new() { Id = from, Name = "星桥纪事", FetchedUtc = DateTime.UtcNow,
            Relations = new() { new() { Id = to, Type = "ANIME", Relation = kind } } };

    static AnimeLocalItem[] BranchItems() => new[]
    {
        Item(101, "星桥纪事", true, A, "tmdb_show:1900000201"),
        Item(102, "星桥纪事 续篇", true, B, "tmdb_show:1900000202"),
        Item(103, "星桥纪事 支线", true, C, "tmdb_show:1900000203"),
        Item(104, "雾港来信", false, D, "tmdb_movie:1900000204", "imdb_movie:tt1900000204")
    };
    static AnimeRelationRecord[] BranchRelations() => new[] { Relation(A, B), Relation(A, C, "SPIN_OFF") };

    static void TestMappings()
    {
        const string json = """
        {"$meta":{"schema_version":"v3","generated_on":"2026-10-17T00:00:00Z"},
         "$includes":["part\u00001",null,{"hi":true}],
         "tmdb_show:1900000201:s1":{"anilist:1900000101":{"1-12":"1-12","13-":null}},
         "tmdb_show:1900000201:s0":{"anilist:1900000103":{"1":"1"}},
         "anilist:1900000102":{"tmdb_movie:1900000202":{"1":"1"}},
         "imdb_movie:tt1900000202":{"anilist:1900000102":{"1":"1"}},
         "tmdb_movie:1900000205":{"mal:1900000105":{"1":"1"}},
         "tvdb_show:1900000206:s2":{"anilist:1900000102":{}}}
        """;
        var index = AnimeMappingIndex.Parse(new StringReader(json));
        Assert(index.Match("TMDB_SHOW", " 1900000201 ").OrderBy(i => i).SequenceEqual(new[] { A, C }), "Season mapping and provider normalization");
        Assert(index.Match("tmdb_movie", "1900000202").Single() == B, "Reverse mapping identity");
        Assert(index.Match("imdb_movie", "tt1900000202").Single() == B, "IMDb mapping identity");
        Assert(index.Match("tvdb_show", "1900000206").Single() == B, "TVDB season mapping");
        Assert(!index.Match("tmdb_movie", "1900000205").Any(), "Do not fabricate AniList links");
        Assert(!index.Match("tmdb_movie", "1900000201").Any(), "Movie and series identities isolated");
        Assert(!index.Match("tmdb_movie", "1900000999").Any(), "Unmapped media stays unmapped");
        foreach (var invalid in new[] { "{}", "{\"bad\":true,}", json + " trailing", json[..^1] })
        {
            bool rejected = false;
            try { AnimeMappingIndex.Parse(new StringReader(invalid)); } catch (Exception) { rejected = true; }
            Assert(rejected, "Empty, malformed, trailing and truncated mappings rejected");
        }
    }

    static void TestGroups()
    {
        var items = BranchItems();
        var records = BranchRelations().Concat(new[] { Relation(A, D, "OTHER") }).ToArray();
        var main = AnimeGroupPlanner.Plan(items, records, false);
        Assert(main.Count == 1 && main[0].EmbyIds.SequenceEqual(new long[] { 101, 102 }), "Disabled spin-off and OTHER excluded");
        Assert(main[0].Name == "星桥纪事", "Existing Chinese title retained");
        Assert(main[0].ReviewRequired, "Disabled branch still requires explicit member review");
        var expanded = AnimeGroupPlanner.Plan(items, records, true);
        Assert(expanded.Count == 1 && expanded[0].EmbyIds.SequenceEqual(new long[] { 101, 102, 103 }), "Optional spin-off connects confirmed media");
        Assert(!expanded[0].ReviewRequired, "Included spin-off alone does not force member-rule review");
        foreach (var kind in new[] { "OTHER", "ADAPTATION", "CHARACTER", "ALTERNATIVE", "ALTERNATIVE_VERSION", "SUMMARY", "COMPILATION", "UNKNOWN" })
            Assert(AnimeGroupPlanner.Plan(new[] { items[0], items[3] }, new[] { Relation(A, D, kind) }, true).Count == 0, kind + " cannot connect collections");
        var manga = Relation(A, D); manga.Relations[0].Type = "MANGA";
        Assert(AnimeGroupPlanner.Plan(new[] { items[0], items[3] }, new[] { manga }, true).Count == 0, "Manga cannot bridge anime collections");
        Assert(AnimeGroupPlanner.Plan(new[] { items[0] }, records, true).Count == 0, "Singleton cannot create collection");
        var aggregate = Item(101, "星桥纪事", true, A); aggregate.AniListIds.AddRange(new[] { A, B });
        var unique = AnimeGroupPlanner.Plan(new[] { aggregate, aggregate, items[2] }, new[] { Relation(B, C) }, true);
        Assert(unique.Count == 1 && unique[0].EmbyIds.SequenceEqual(new long[] { 101, 103 }), "Multi-entry series and repeated local IDs deduplicate members");
        var fork = AnimeGroupPlanner.Plan(items, new[] { Relation(A, B), Relation(A, C) }, false);
        Assert(fork.Single().ReviewRequired, "Generic sequel fork requires review without title or ID exceptions");
    }

    static void TestAnchorGraphMinAndSticky()
    {
        // Local library only has B+C; relation graph also knows earlier A → Anchor is A (graph min).
        var localOnlyLater = new[]
        {
            Item(102, "星桥纪事 续篇", true, B, "tmdb_show:1900000202"),
            Item(103, "星桥纪事 支线", true, C, "tmdb_show:1900000203")
        };
        var planned = AnimeGroupPlanner.Plan(localOnlyLater, BranchRelations(), true);
        Assert(planned.Count == 1 && planned[0].Anchor == A && planned[0].Key == Key,
            "Anchor uses min ID over library ∪ relation-graph nodes");
        Assert(!planned[0].ReviewRequired, "Spin-off included without sequel fork does not require review");

        var drifting = new AnimeGroup { Anchor = B, Name = "漂移", EmbyIds = new() { 101, 102 } };
        Assert(drifting.Key == "anilist:" + B, "Precondition: drifting key follows planned anchor");
        var owned = new[] { new AnimeManagedCollection { CollectionId = 901, Anchor = A, ManagedItemIds = new() { 101, 102 } } };
        AnimeCollectionPolicy.ApplyOwnershipSticky(new List<AnimeGroup> { drifting }, owned);
        Assert(drifting.Anchor == A && drifting.Key == Key, "Ownership sticky restores prior Anchor/Key");

        var policy = AnimeCollectionPolicy.Parse("", Key, "");
        Assert(policy.ExplainWriteBlock(new AnimeGroup { Anchor = A, EmbyIds = new() { 101 } }) == "成员不足两部。", "Explain: too few members");
        Assert(policy.ExplainWriteBlock(new AnimeGroup { Anchor = D, EmbyIds = new() { 101, 102 } }) == "未在批准名单中。", "Explain: not approved");
        var branchMsg = policy.ExplainWriteBlock(new AnimeGroup { Anchor = A, EmbyIds = new() { 101, 102 }, ReviewRequired = true });
        Assert(branchMsg == null, "Explain: branch flag alone does not block write");
        Assert(AnimeCollectionPolicy.Parse("", "", "").ExplainWriteBlock(new AnimeGroup { Anchor = A, EmbyIds = new() { 101, 102 }, ReviewRequired = true }) == null,
            "Explain: empty approval list does not report not-approved");
        var ok = new AnimeGroup { Anchor = A, EmbyIds = new() { 101, 102 } };
        Assert(policy.ExplainWriteBlock(ok) == null && policy.CanWrite(ok, false), "Explain null when writable");

        // Alternative still forces review even with spin-offs included.
        var alt = AnimeGroupPlanner.Plan(
            new[] { Item(101, "星桥纪事", true, A), Item(104, "雾港来信", false, D) },
            new[] { Relation(A, D, "ALTERNATIVE") }, true);
        Assert(alt.Count == 0, "ALTERNATIVE does not connect; separate from branch marking");
        var altConnected = AnimeGroupPlanner.Plan(
            new[] { Item(101, "甲", true, A), Item(102, "乙", true, B) },
            new[] { Relation(A, B, "SEQUEL"), Relation(A, B, "ALTERNATIVE") }, true);
        // SEQUEL connects; ALTERNATIVE marks branch
        Assert(altConnected.Count == 1 && altConnected[0].ReviewRequired, "ALTERNATIVE marks review even when spin-offs included");
    }

    static async Task TestGraphExpansion()
    {
        var cache = new Dictionary<int, AnimeRelationRecord>(); int calls = 0, saves = 0;
        Task<AnimeRelationRecord> Fetch(int id, CancellationToken token) { calls++; return Task.FromResult(new AnimeRelationRecord { Id = id, FetchedUtc = DateTime.UtcNow }); }
        var partial = await AnimeGraphExpansion.ExpandAsync(new[] { A, B }, 1, 100, 14, true, cache, Fetch, () => saves++, CancellationToken.None, _ => { });
        Assert(!partial.Complete && partial.Records.Count == 1 && calls == 1 && saves == 1, "Partial graph saves cache but never reports completion");
        var resumed = await AnimeGraphExpansion.ExpandAsync(new[] { A, B }, 1, 100, 14, true, cache, Fetch, () => saves++, CancellationToken.None, _ => { });
        Assert(resumed.Complete && resumed.NetworkRequests == 1, "Next graph run resumes using cache");
        var cached = await AnimeGraphExpansion.ExpandAsync(new[] { A, A, B, 0, -1 }, 0, 100, 14, true, cache, Fetch, () => saves++, CancellationToken.None, _ => { });
        Assert(cached.Complete && cached.Records.Count == 2 && cached.NetworkRequests == 0, "Cache deduplicates valid seeds without requests");
        var zero = await AnimeGraphExpansion.ExpandAsync(new[] { C }, 0, 100, 14, true, cache, Fetch, () => saves++, CancellationToken.None, _ => { });
        Assert(!zero.Complete && zero.Records.Count == 0, "Zero graph budget blocks uncached seeds");
        var bounded = await AnimeGraphExpansion.ExpandAsync(new[] { A, B }, 1, 1, 14, true, cache, Fetch, () => saves++, CancellationToken.None, _ => { });
        Assert(!bounded.Complete, "Node limit never silently completes graph");
        bool failed = false;
        try { await AnimeGraphExpansion.ExpandAsync(new[] { D }, 1, 100, 14, true, cache, (_, _) => throw new HttpRequestException("Synthetic server failure"), () => saves++, CancellationToken.None, _ => { }); }
        catch (HttpRequestException) { failed = true; }
        Assert(failed, "Fetch errors propagate rather than becoming empty successful graphs");
        using var canceled = new CancellationTokenSource(); canceled.Cancel(); bool stopped = false;
        try { await AnimeGraphExpansion.ExpandAsync(new[] { A }, 1, 100, 14, true, cache, Fetch, () => saves++, canceled.Token, _ => { }); }
        catch (OperationCanceledException) { stopped = true; }
        Assert(stopped, "Cancellation prevents graph completion");
        cache[A].FetchedUtc = DateTime.UtcNow.AddDays(-30);
        var stale = await AnimeGraphExpansion.ExpandAsync(new[] { A }, 0, 100, 14, true, cache, Fetch, () => saves++, CancellationToken.None, _ => { });
        Assert(!stale.Complete, "Stale cache cannot bypass graph budget");
        var chain = Enumerable.Range(A, 5).ToDictionary(id => id, id => Relation(id, id + 1));
        var hops = await AnimeGraphExpansion.ExpandAsync(new[] { A }, 0, 100, 14, true, chain, Fetch, () => { }, CancellationToken.None, _ => { });
        Assert(hops.Complete && hops.Records.Select(r => r.Id).SequenceEqual(new[] { A, B, C }), "Graph expansion bounded to two hops");
    }

    static void TestDuplicates()
    {
        var items = new[] {
            Item(1, "云帆电影", false, 0, " TMDB_MOVIE:1900000301 ", "IMDB_MOVIE:TT1900000301", "tvdb_movie:1900000301"),
            Item(2, "云帆电影 副本", false, 0, "tmdb_movie:1900000301", " imdb_movie:tt1900000301 ", "TVDB_MOVIE:1900000301"),
            Item(3, "云帆长篇", true, 0, "tmdb_show:1900000301", "imdb_show:tt1900000301", "tvdb_show:1900000301"),
            Item(4, "云帆长篇 副本", true, 0, " TMDB_SHOW:1900000301 ", "IMDB_SHOW:TT1900000301", " tvdb_show:1900000301 ") };
        var before = JsonSerializer.Serialize(items); var duplicates = AnimeCollectionPolicy.FindDuplicates(items);
        Assert(duplicates.Count == 6, "Three providers retain movie/series duplicate evidence separately");
        foreach (var provider in new[] { "tmdb", "imdb", "tvdb" })
        {
            var suffix = provider == "imdb" ? "tt1900000301" : "1900000301";
            Assert(duplicates.Single(d => d.Identifier == provider + "_movie:" + suffix).EmbyIds.SequenceEqual(new long[] { 1, 2 }), "Typed normalized movie duplicates");
            Assert(duplicates.Single(d => d.Identifier == provider + "_show:" + suffix).EmbyIds.SequenceEqual(new long[] { 3, 4 }), "Typed normalized series duplicates");
        }
        Assert(JsonSerializer.Serialize(items) == before, "Duplicate diagnostics never mutate local media");
        Assert(!AnimeCollectionPolicy.FindDuplicates(new[] { Item(5, "重复元数据", false, 0, "tmdb_movie:1900000301", " TMDB_MOVIE:1900000301 ") }).Any(), "Repeated provider on one item is not duplicate media");
        Assert(!AnimeCollectionPolicy.FindDuplicates(new[] { Item(6, "聚合季", true, A, "tmdb_show:1900000302"), Item(7, "聚合电影", false, A, "tmdb_movie:1900000303") }).Any(), "Shared AniList identity is not duplicate provider media");
    }

    static void TestExactMembership()
    {
        var items = BranchItems();
        foreach (bool spinOff in new[] { false, true })
        {
            var automatic = AnimeGroupPlanner.Plan(items, BranchRelations(), spinOff);
            var approvalOnly = AnimeCollectionPolicy.Parse("", Key, "");
            var approvedGroup = approvalOnly.Apply(automatic, items).Single();
            Assert(approvalOnly.CanWrite(approvedGroup, false),
                spinOff
                    ? "Approved mainline+spin-off may write without JSON when spin-offs included"
                    : "Approved key may write even when branch review is flagged");
            var policy = AnimeCollectionPolicy.Parse(Rules, Key, ""); var selected = policy.Apply(automatic, items);
            Assert(selected.Single().EmbyIds.SequenceEqual(new long[] { 101, 102 }), "Exact IncludeIds membership with ExcludeIds precedence");
            Assert(selected[0].HasExplicitRule && policy.CanWrite(selected[0], false), "Explicit approved exact selection may write");
            Assert(!policy.CanWrite(selected[0], true), "DryRun always denies writes");
        }
        var contaminated = AnimeGroupPlanner.Plan(items, BranchRelations().Concat(new[] { Relation(C, D) }), true);
        Assert(contaminated.Single().EmbyIds.Count == 4, "Contaminated fixture actually includes branch and unrelated member");
        Assert(AnimeCollectionPolicy.Parse(Rules, Key, "").Apply(contaminated, items).Single().EmbyIds.SequenceEqual(new long[] { 101, 102 }), "Exact rule replaces whole component without unsafe residual groups");
        var overlap = AnimeCollectionPolicy.Parse("""
            [{"Key":"anilist:1900000101","IncludeIds":["anilist:1900000101","anilist:1900000102"]},
             {"Key":"anilist:1900000103","IncludeIds":["tmdb_show:1900000202","anilist:1900000103"]}]
            """, "", "");
        Reject(() => overlap.Apply(AnimeGroupPlanner.Plan(items, BranchRelations(), true), items), "Different identifiers selecting same media across rules fail closed");
    }

    static void TestAliasesAndApproval()
    {
        var items = new[] { Item(1, "纸月航线", true, A), Item(2, "纸月航线 电影", false, B), Item(3, "琉璃山谷", true, C), Item(4, "琉璃山谷 续篇", true, D) };
        var automatic = AnimeGroupPlanner.Plan(items, new[] { Relation(A, B), Relation(C, D) }, true);
        var empty = AnimeCollectionPolicy.Parse("", "", ""); var defaults = empty.Apply(automatic, items);
        Assert(defaults.Single(g => g.Key == Key).Name == "纸月航线" && defaults.Single(g => g.Anchor == C).Name == "琉璃山谷", "No built-in aliases: deterministic input names remain unchanged");
        Assert(defaults.All(g => empty.CanWrite(g, false)), "Empty approval list auto-allows all candidate writes");
        var approved = AnimeCollectionPolicy.Parse("", " \r\n " + Key + " \r\n", """{"anilist:1900000101":"用户纸月"}""");
        var groups = approved.Apply(automatic, items); var first = groups.Single(g => g.Key == Key);
        Assert(first.Name == "用户纸月" && approved.CanWrite(first, false), "User-only alias and trimmed exact approval work");
        Assert(!approved.CanWrite(groups.Single(g => g.Anchor == C), false), "Approval never spreads to another key");
        Assert(!approved.CanWrite(new AnimeGroup { Anchor = D, Name = "用户纸月", EmbyIds = new() { 8, 9 } }, false), "Same display name grants no permission");
        Assert(!approved.CanWrite(first, true), "DryRun overrides approved alias");
    }

    static void TestCollectionEditorRewrite()
    {
        var rules = AnimeCollectionEditorSupport.UpsertExactRule("", Key, new[] { "anilist:1900000101", "tmdb_show:1900000202" });
        var policy = AnimeCollectionPolicy.Parse(rules, "", "");
        Assert(policy.HasExactRule(Key), "Editor upsert writes exact rule");
        Assert(policy.ExactIncludeIds(Key).SequenceEqual(new[] { "anilist:1900000101", "tmdb_show:1900000202" }), "Editor include ids round-trip");
        var aliases = AnimeCollectionEditorSupport.UpsertAlias("", Key, "用户纸月");
        Assert(AnimeCollectionPolicy.Parse("", "", aliases).TryGetAlias(Key, out var alias) && alias == "用户纸月", "Editor alias upsert");
        var updated = AnimeCollectionEditorSupport.UpsertExactRule(rules, Key, new[] { "anilist:1900000101", "anilist:1900000102" });
        Assert(AnimeCollectionPolicy.Parse(updated, "", "").ExactIncludeIds(Key).SequenceEqual(new[] { "anilist:1900000101", "anilist:1900000102" }), "Editor replaces include set");
        var cleared = AnimeCollectionEditorSupport.RemoveExactRule(updated, Key);
        Assert(cleared == "" || !AnimeCollectionPolicy.Parse(cleared, "", "").HasExactRule(Key), "Editor clear removes exact rule");
        Assert(AnimeCollectionEditorSupport.EnsureApprovedKey("", Key) == "", "Empty approval list stays empty");
        var approved = AnimeCollectionEditorSupport.EnsureApprovedKey("anilist:1900000103", Key);
        Assert(approved.Contains(Key) && approved.Contains("anilist:1900000103"), "Non-empty approval gains editor key");
        Assert(AnimeCollectionEditorSupport.PrimaryIncludeId(Item(1, "星桥", true, A, "tmdb_show:1900000201")) == Key, "Primary include prefers anilist");
        Assert(AnimeCollectionEditorSupport.PrimaryIncludeId(Item(2, "雾港", false, 0, "tmdb_movie:1900000204")) == "tmdb_movie:1900000204", "Primary include falls back to typed provider");
        Reject(() => AnimeCollectionEditorSupport.UpsertExactRule("", Key, new[] { "bad" }), "Editor rejects invalid include id");
        Reject(() => AnimeCollectionEditorSupport.UpsertAlias("", Key, " "), "Editor rejects blank display name");
    }


    static void TestCollectionGraphSubgraph()
    {
        Assert(AnimeCollectionGraphSupport.RelationLabelZh("SEQUEL") == "续作", "Sequel label is plain Chinese");
        Assert(AnimeCollectionGraphSupport.RelationLabelZh("PREQUEL") == "前传", "Prequel label is plain Chinese");
        Assert(AnimeCollectionGraphSupport.RelationLabelZh("SIDE_STORY") == "外传", "Side story label is plain Chinese");
        Assert(AnimeCollectionGraphSupport.RelationLabelZh("PARENT") == "母作品", "Parent label is plain Chinese");
        Assert(AnimeCollectionGraphSupport.RelationLabelZh("SPIN_OFF") == "衍生", "Spin-off label is plain Chinese");
        Assert(AnimeCollectionGraphSupport.RelationLabelZh("ALTERNATIVE_VERSION") == "另一版本", "Alternative label is plain Chinese");
        Assert(!AnimeCollectionGraphSupport.RelationLabelZh("SEQUEL").Contains("SEQUEL"), "Labels never expose English enum as primary text");

        // Fate-like multi-line: root → sequel A, root → spin-off, sequel A → sequel B; missing local title for spin-off.
        var records = new[]
        {
            new AnimeRelationRecord
            {
                Id = A, Name = "星桥纪事", FetchedUtc = DateTime.UtcNow,
                Relations = new()
                {
                    new() { Id = B, Relation = "SEQUEL", Name = "星桥纪事 续篇", Type = "ANIME" },
                    new() { Id = C, Relation = "SPIN_OFF", Name = "星桥外传", Type = "ANIME" },
                    new() { Id = D, Relation = "PREQUEL", Name = "星桥前史", Type = "ANIME" }
                }
            },
            new AnimeRelationRecord
            {
                Id = B, Name = "星桥纪事 续篇", FetchedUtc = DateTime.UtcNow,
                Relations = new()
                {
                    new() { Id = A, Relation = "PREQUEL", Name = "星桥纪事", Type = "ANIME" }
                }
            },
            new AnimeRelationRecord
            {
                Id = C, Name = "星桥外传", FetchedUtc = DateTime.UtcNow,
                Relations = new()
                {
                    new() { Id = A, Relation = "PARENT", Name = "星桥纪事", Type = "ANIME" }
                }
            },
            new AnimeRelationRecord
            {
                Id = D, Name = "星桥前史", FetchedUtc = DateTime.UtcNow,
                Relations = new()
                {
                    new() { Id = A, Relation = "SEQUEL", Name = "星桥纪事", Type = "ANIME" }
                }
            }
        };
        var library = new Dictionary<int, string> { [A] = "本地星桥", [B] = "本地续篇", [D] = "本地前史" };
        var selected = new[] { A, B };
        var graph = AnimeCollectionGraphSupport.Build(A, records, library, selected, includeSpinOffs: true);
        Assert(graph.Nodes.Count >= 4, "Multi-line subgraph keeps prequel/sequel/spin-off nodes");
        Assert(graph.Edges.Count >= 3, "Subgraph keeps continuity edges");
        Assert(graph.Nodes.Any(n => n.AniListId == C && !n.InLibrary && n.Title.Contains("外传")), "Missing library node is gray-path capable");
        Assert(graph.Nodes.Single(n => n.AniListId == A).InLibrary && graph.Nodes.Single(n => n.AniListId == A).InCollection, "Seed in library + collection highlighted");
        Assert(graph.Edges.Any(e => e.Label == "续作") && graph.Edges.Any(e => e.Label == "前传"), "Edge labels use human words");
        Assert(graph.Edges.Any(e => e.Label == "衍生" || e.Label == "母作品"), "Spin-off/parent edges labeled in Chinese");
        Assert(graph.Nodes.All(n => n.X >= 0 && n.Y >= 0), "Layered layout assigns non-negative coordinates");
        Assert(graph.Nodes.Select(n => n.AniListId).Distinct().Count() == graph.Nodes.Count, "Node ids unique");

        var noSpin = AnimeCollectionGraphSupport.Build(A, records, library, selected, includeSpinOffs: false);
        Assert(!noSpin.Nodes.Any(n => n.AniListId == C) || !noSpin.Edges.Any(e => e.From == A && e.To == C && e.Relation == "SPIN_OFF"),
            "Disabling spin-offs omits spin-off walk from seed");

        var ids = AnimeCollectionGraphSupport.ParseAniListIds(new[] { "anilist:1900000101", "tmdb_show:1", "anilist:1900000102", "anilist:1900000101" });
        Assert(ids.SequenceEqual(new[] { A, B }), "ParseAniListIds keeps unique positive anilist ids");
    }

    static void TestInvalidPolicies()
    {
        foreach (var json in new[] { "{", "{}", "null", """[{"Key":"franchise:main","IncludeIds":[]}]""", """[{"Key":"anilist:01900000101","IncludeIds":[]}]""", """[{"Key":"anilist:2147483648","IncludeIds":[]}]""", """[{"Key":"anilist:1900000101","IncludeIds":["movie:1900000201"]}]""", """[{"Key":"anilist:1900000101","IncludeIds":["anilist:0"]}]""", """[{"Key":"anilist:1900000101","IncludeIds":[],"Unexpected":true}]""", """[{"Key":"anilist:1900000101","IncludeIds":[]},{"Key":"anilist:1900000101","IncludeIds":[]}]""" })
            Reject(() => AnimeCollectionPolicy.Parse(json, "", ""), "Invalid member rules rejected before writes");
        foreach (var aliases in new[] { "{", "[]", """{"anilist:1900000101":42}""", """{"anilist:1900000101":""}""", """{"anilist:1900000101":"bad\ntext"}""" })
            Reject(() => AnimeCollectionPolicy.Parse("", "", aliases), "Malformed aliases fail closed");
        foreach (var approval in new[] { "纸月航线", Key + ",anilist:1900000103", "ANILIST:1900000101", "anilist:0", "anilist:01900000101", Key + "\n" + Key })
            Reject(() => AnimeCollectionPolicy.Parse("", approval, ""), "Malformed or display-name approval fails closed");
    }

    static void TestOwnership()
    {
        var next = AnimeCollectionMembership.NextOwned(new long[] { 1, 2 }, new long[] { 4 }, Array.Empty<long>());
        Assert(next.SequenceEqual(new long[] { 1, 2, 4 }), "Manual desired member never adopted, uncertain ownership retained");
        Assert(AnimeCollectionMembership.NextOwned(next, Array.Empty<long>(), new long[] { 2 }).SequenceEqual(new long[] { 1, 4 }), "Only confirmed removal relinquishes ownership");
        Assert(AnimeCollectionPolicy.CanUseIdentity(null, null, Array.Empty<long>()), "New identity with no name collision allowed");
        Assert(!AnimeCollectionPolicy.CanUseIdentity(null, 900, new long[] { 900 }), "Manual collection cannot be adopted");
        Assert(!AnimeCollectionPolicy.CanUseIdentity(null, null, new long[] { 900 }), "Manual name collision blocks creation");
        Assert(AnimeCollectionPolicy.CanUseIdentity(901, 901, new long[] { 901 }), "Owned exact identity accepted");
        Assert(!AnimeCollectionPolicy.CanUseIdentity(901, 900, new long[] { 900 }), "Same name never replaces owned collection ID");
        Assert(!AnimeCollectionPolicy.CanUseIdentity(901, 901, new long[] { 901, 900 }), "Manual alias collision blocks owned update");
        var group = new AnimeGroup { Anchor = A, Name = "星桥纪事", EmbyIds = new() { 101, 103 } };
        var state = new[] { new AnimeManagedCollection { CollectionId = 901, Anchor = A, ManagedItemIds = new() { 101, 102 } } };
        var branch = new AnimeGroup { Anchor = C, Name = "支线", ReviewRequired = true, EmbyIds = new() { 102, 104 } };
        Assert(AnimeCollectionPolicy.FindSplitCollectionIds(new[] { group, branch }, state).SetEquals(new long[] { 901 }), "Denied branch still detects split of owned collection");
        Assert(!AnimeCollectionPolicy.FindSplitCollectionIds(new[] { group }, state).Any(), "One resulting group is not split");
        Assert(!AnimeCollectionPolicy.PlanRemovals(group, new long[] { 101, 102 }, new long[] { 101, 102, 999 }, Array.Empty<long>()).Any(), "Uncertainty retains owned members");
        Assert(AnimeCollectionPolicy.PlanRemovals(group, new long[] { 101, 102 }, new long[] { 101, 102, 999 }, new long[] { 102, 999 }).SequenceEqual(new long[] { 102 }), "Reassignment removes owned members only");
        group.HasExplicitRule = true;
        Assert(AnimeCollectionPolicy.PlanRemovals(group, new long[] { 101, 102, 105 }, new long[] { 101, 102, 999 }, Array.Empty<long>()).SequenceEqual(new long[] { 102 }), "Exact selection removes present excluded owned members, never manual members");
    }

    static void TestLegacyStateAndCache()
    {
        var record = JsonSerializer.Deserialize<AnimeRelationRecord>("""{"Id":1900000101,"Name":"星桥纪事","FetchedUtc":"2026-10-01T12:00:00Z","Relations":[{"Id":1900000102,"Relation":"SEQUEL","Name":"星桥续篇","Type":"ANIME"}]}""")!;
        var restored = JsonSerializer.Deserialize<AnimeRelationRecord>(JsonSerializer.Serialize(record))!;
        Assert(restored.Id == A && restored.Name == record.Name && restored.FetchedUtc == record.FetchedUtc && restored.Relations.Single().Id == B, "Legacy relation cache schema round-trips unchanged");
        var cache = JsonSerializer.Deserialize<AnimeAiDecisionCache>("""{"Decisions":{"1900000101:1900000102":{"Approved":false,"CheckedUtc":"2026-10-01T12:00:00Z"}}}""")!;
        var cached = JsonSerializer.Deserialize<AnimeAiDecisionCache>(JsonSerializer.Serialize(cache))!;
        Assert(!cached.Decisions["1900000101:1900000102"].Approved && cached.Decisions["1900000101:1900000102"].CheckedUtc == DateTime.Parse("2026-10-01T12:00:00Z").ToUniversalTime(), "Legacy denied AI decision and timestamp retained");
        var state = JsonSerializer.Deserialize<AnimeCollectionState>("""{"Collections":[{"CollectionId":901,"Anchor":1900000101,"Name":"星桥纪事","ManagedItemIds":[101,102]}]}""")!;
        var stateAgain = JsonSerializer.Deserialize<AnimeCollectionState>(JsonSerializer.Serialize(state))!;
        Assert(stateAgain.Collections.Single().CollectionId == 901 && stateAgain.Collections[0].Anchor == A && stateAgain.Collections[0].ManagedItemIds.SequenceEqual(new long[] { 101, 102 }), "Legacy owned identity, anchor and membership survive schema round-trip");
        Assert(AnimeCollectionPolicy.Parse("", "", "").CanWrite(new AnimeGroup { Anchor = A, EmbyIds = new() { 101, 102 } }, false), "Empty approval list allows write regardless of ownership records");
        Assert(!AnimeCollectionPolicy.Parse("", "anilist:1900000103", "").CanWrite(new AnimeGroup { Anchor = A, EmbyIds = new() { 101, 102 } }, false), "Non-empty approval list still restricts to listed keys");
    }

    static void TestConfigurationCompatibility()
    {
        var serializer = new XmlSerializer(typeof(PluginConfiguration));
        using var reader = new StringReader("""<PluginConfiguration><AnimeEnabled>true</AnimeEnabled><AnimeDryRun>false</AnimeDryRun><DryRunMode>false</DryRunMode><AnimeCollectionPrefix>旧动漫 · </AnimeCollectionPrefix></PluginConfiguration>""");
        var config = (PluginConfiguration)serializer.Deserialize(reader)!;
        Assert(config.AnimeEnabled && !config.AnimeDryRun && !config.DryRunMode && config.AnimeCollectionPrefix == "旧动漫 · ", "Legacy explicit settings preserved");
        Assert(config.AnimeCollectionRulesJson == "" && config.AnimeApprovedCollectionKeys == "" && config.AnimeCollectionAliasesJson == "", "Missing policy config defaults empty");
        var policy = AnimeCollectionPolicy.Parse("", "", ""); var local = BranchItems();
        Assert(policy.Apply(AnimeGroupPlanner.Plan(local, BranchRelations(), false), local).Where(g => g.EmbyIds.Count >= 2).All(g => policy.CanWrite(g, false)), "Empty approval list auto-allows writes even when branch review is flagged");
        Assert(!new PluginConfiguration().AnimeDryRun, "AnimeDryRun defaults to false for new installs");
        config.AnimeCollectionRulesJson = Rules; config.AnimeApprovedCollectionKeys = Key + "\nanilist:1900000103"; config.AnimeCollectionAliasesJson = """{"anilist:1900000101":"星桥 · 精选"}""";
        using var xml = new StringWriter(); serializer.Serialize(xml, config); using var xmlReader = new StringReader(xml.ToString());
        var restored = (PluginConfiguration)serializer.Deserialize(xmlReader)!;
        Assert(restored.AnimeCollectionRulesJson == config.AnimeCollectionRulesJson && restored.AnimeApprovedCollectionKeys == config.AnimeApprovedCollectionKeys && restored.AnimeCollectionAliasesJson == config.AnimeCollectionAliasesJson, "XML round-trip preserves exact policy strings");
        var json = JsonSerializer.Deserialize<PluginConfiguration>(JsonSerializer.Serialize(config))!;
        Assert(json.AnimeCollectionRulesJson == config.AnimeCollectionRulesJson && json.AnimeApprovedCollectionKeys == config.AnimeApprovedCollectionKeys && json.AnimeCollectionAliasesJson == config.AnimeCollectionAliasesJson, "JSON round-trip preserves policy strings");
        var restoredPolicy = AnimeCollectionPolicy.Parse(restored.AnimeCollectionRulesJson, restored.AnimeApprovedCollectionKeys, restored.AnimeCollectionAliasesJson);
        var selected = restoredPolicy.Apply(AnimeGroupPlanner.Plan(local, BranchRelations(), true), local).Single();
        Assert(selected.Name == "星桥 · 精选" && restoredPolicy.CanWrite(selected, restored.DryRunMode || restored.AnimeDryRun), "Round-tripped config drives actual exact-member write predicate");
        TestAiConfigurationCompatibility(serializer);
    }

    static AnimeLocalItem[] PreviewItems() => BranchItems().Where(i => i.EmbyId != 104).Concat(new[] {
        Item(201, "云帆学园", true, 1900000401, "tmdb_show:1900000501", "imdb_show:tt1900000501", "tvdb_show:1900000501"),
        Item(202, "云帆学园 副本", true, 1900000401, " TMDB_SHOW:1900000501 ", "IMDB_SHOW:TT1900000501", "tvdb_show:1900000501"),
        Item(203, "晨星远航 电影", false, 1900000403, "tmdb_movie:1900000503", "imdb_movie:tt1900000503"),
        Item(204, "晨星远航 电影副本", false, 1900000403, " TMDB_MOVIE:1900000503 ", "imdb_movie:tt1900000503"),
        new AnimeLocalItem { EmbyId = 205, Name = "晨星远航", IsSeries = true, AniListIds = new() { 1900000402, 1900000403 }, ProviderIds = new() { "tmdb_show:1900000502" } },
        Item(206, "雾港来信", false, D, "tmdb_movie:1900000504"),
        Item(207, "雾港回声", false, 1900000105, "tmdb_movie:1900000505") }).ToArray();
    static AnimeRelationRecord[] PreviewRelations() => BranchRelations().Concat(new[] { Relation(D, 1900000105) }).ToArray();

    static void TestPreviewCases()
    {
        var items = PreviewItems(); var before = JsonSerializer.Serialize(items); var duplicates = AnimeCollectionPolicy.FindDuplicates(items);
        Assert(duplicates.Single(d => d.Identifier == "tmdb_show:1900000501").EmbyIds.SequenceEqual(new long[] { 201, 202 }), "CLI series duplicate fixture retains both local IDs");
        Assert(duplicates.Single(d => d.Identifier == "imdb_show:tt1900000501").EmbyIds.Count == 2 && duplicates.Single(d => d.Identifier == "tvdb_show:1900000501").EmbyIds.Count == 2, "CLI duplicate fixture retains all provider evidence");
        Assert(duplicates.Single(d => d.Identifier == "tmdb_movie:1900000503").EmbyIds.SequenceEqual(new long[] { 203, 204 }) && duplicates.Single(d => d.Identifier == "imdb_movie:tt1900000503").EmbyIds.Count == 2, "CLI movie duplicate fixture preserves identities");
        var policy = AnimeCollectionPolicy.Parse(Rules, Key, ""); var groups = policy.Apply(AnimeGroupPlanner.Plan(items, PreviewRelations(), false), items);
        Assert(groups.Single(g => g.Anchor == 1900000402).EmbyIds.SequenceEqual(new long[] { 203, 204, 205 }), "Duplicate diagnostics do not drop planned movie members");
        Assert(groups.Single(g => g.Key == Key).EmbyIds.SequenceEqual(new long[] { 101, 102 }), "Unrelated sequel pair never leaks into exact branch selection");
        Assert(!policy.CanWrite(groups.Single(g => g.Anchor == D), false), "Unapproved unrelated sequel remains separate and read-only");
        Assert(groups.All(g => !policy.CanWrite(g, true)) && JsonSerializer.Serialize(items) == before, "CLI DryRun denies every write and preserves fixture inputs");
    }

    static void PrintPreviewDemo()
    {
        var items = PreviewItems(); var automatic = AnimeGroupPlanner.Plan(items, PreviewRelations(), false);
        var policy = AnimeCollectionPolicy.Parse(Rules, Key, "");
        Console.WriteLine(JsonSerializer.Serialize(new {
            Source = "OFFLINE FICTIONAL FIXTURES — synthetic names and IDs; no server access", DryRun = true,
            AutomaticReview = automatic.Select(g => new { g.Key, g.ReviewRequired, Members = g.EmbyIds }),
            Groups = policy.Apply(automatic, items).Select(g => new { g.Key, g.Name, Members = g.EmbyIds, g.HasExplicitRule, g.ReviewRequired, ApprovedOutsideDryRun = policy.CanWrite(g, false), WritesAllowedNow = policy.CanWrite(g, true) }),
            Duplicates = AnimeCollectionPolicy.FindDuplicates(items)
        }, new JsonSerializerOptions { WriteIndented = true }));
    }
}
