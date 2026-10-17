using System.Text.Json;
using HomeScreenCompanion;

static class Program
{
    private static int _passed;
    static int Main(string[] args)
    {
        try
        {
            if (args.SequenceEqual(new[] { "--preview-demo" }))
            {
                PrintPreviewDemo();
                return 0;
            }
            TestMappings();
            TestGroups();
            TestAdditionalMappingsAndGroups();
            TestOwnership();
            TestGraphExpansion().GetAwaiter().GetResult();
            TestDuplicateDiagnostics();
            TestExactFateMembership();
            TestApprovalAndAliases();
            TestInvalidPolicies();
            TestCacheRoundTrip();
            TestOwnershipIdentityAndLegacyState();
            TestConfigurationCompatibility();
            TestReportedLibraryCases();
            Console.WriteLine($"PASS: {_passed} assertions");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("FAIL: " + ex);
            return 1;
        }
    }

    static void Assert(bool result, string name)
    {
        if (!result) throw new Exception(name);
        _passed++;
    }

    static void TestMappings()
    {
        const string json = """
        {
            "$meta": {"schema_version":"v3", "generated_on":"2026-10-17T00:00:00Z"},
            "$includes": ["part\\u00001", null, {"hi":true}],
            "tmdb_show:55:s1": {"anilist:100": {"1-12": "1-12", "13-": null}},
            "tmdb_show:55:s0": {"anilist:103": {"1": "1"}},
            "anilist:101": {"tmdb_movie:77": {"1": "1"}},
            "imdb_movie:tt1999": {"anilist:101": {"1": "1"}},
            "tmdb_movie:88": {"mal:3": {"1": "1"}}
        }
        """;
        var index = AnimeMappingIndex.Parse(new StringReader(json));
        Assert(index.Match("tmdb_show", "55").OrderBy(i => i).SequenceEqual(new[] {100,103}), "TMDB season IDs");
        Assert(index.Match("tmdb_movie", "77").Single() == 101, "AniList -> TMDB reverse identity");
        Assert(index.Match("imdb_movie", "tt1999").Single() == 101, "IMDb identity");
        Assert(!index.Match("tmdb_movie", "88").Any(), "Do not fabricate AniList links");
        Assert(!index.Match("tmdb_movie", "999").Any(), "Missing media stays missing");
        bool invalid = false;
        try { AnimeMappingIndex.Parse(new StringReader("{\"bad\": true, }")); }
        catch (Exception) { invalid = true; }
        Assert(invalid, "Malformed JSON rejected");
    }

    static void TestGroups()
    {
        var items = new[]
        {
            new AnimeLocalItem {EmbyId = 1, IsSeries = true, Name = "银魂", AniListIds = new() {100}},
            new AnimeLocalItem {EmbyId = 2, IsSeries = false, Name = "银魂 剧场版", AniListIds = new() {101}},
            new AnimeLocalItem {EmbyId = 3, IsSeries = false, Name = "银魂 外传", AniListIds = new() {102}},
            new AnimeLocalItem {EmbyId = 4, IsSeries = false, Name = "不相关作品", AniListIds = new() {777}}
        };
        var records = new[]
        {
            new AnimeRelationRecord {Id = 100, Relations = new() {
                new AnimeRelation {Id = 101, Type = "ANIME", Relation = "SEQUEL"},
                new AnimeRelation {Id = 999, Type = "MANGA", Relation = "SEQUEL"},
                new AnimeRelation {Id = 777, Type = "ANIME", Relation = "OTHER"}
            }},
            new AnimeRelationRecord {Id = 101, Relations = new() {
                new AnimeRelation {Id = 102, Type = "ANIME", Relation = "SPIN_OFF"}
            }}
        };
        var noSpinoff = AnimeGroupPlanner.Plan(items, records, false);
        Assert(noSpinoff.Count == 1, "Two confirmed works produce one group");
        Assert(noSpinoff[0].EmbyIds.SequenceEqual(new long[] {1,2}), "Spin-off optional and OTHER excluded");
        Assert(noSpinoff[0].Name == "银魂", "Chinese IP title");
        var withSpinoff = AnimeGroupPlanner.Plan(items, records, true);
        Assert(withSpinoff.Count == 1 && withSpinoff[0].EmbyIds.SequenceEqual(new long[] {1,2,3}), "Spin-off grouping");
        Assert(!AnimeGroupPlanner.IsSafeRelation("ADAPTATION", true), "Adaptation is unsafe");
        Assert(!AnimeGroupPlanner.IsSafeRelation("CHARACTER", true), "Character is unsafe");
        Assert(!AnimeGroupPlanner.IsSafeRelation("OTHER", true), "Unverified other is unsafe");
        var single = AnimeGroupPlanner.Plan(new[] {items[0]}, Array.Empty<AnimeRelationRecord>(), true);
        Assert(single.Count == 0, "Single titles do not generate collections");
    }

    static void TestAdditionalMappingsAndGroups()
    {
        var index = AnimeMappingIndex.Parse(new StringReader("""
            {"tmdb_show:55:s1":{"anilist:100":{}},"tmdb_show:55:s2":{"anilist:100":{}},
             "tvdb_show:6:s2":{"anilist:101":{}},"anilist:101":{"tmdb_movie:77":{}}}
            """));
        Assert(index.Match("TMDB_SHOW", " 55 ").SequenceEqual(new[]{100}), "Duplicate mapping links deduplicated");
        Assert(index.Match("tvdb_show", "6").Single() == 101, "TVDB season scope folded");
        Assert(!index.Match("tmdb_movie", "55").Any(), "Movie and series IDs are separate");
        foreach (var invalid in new[]{"{}", "{\"tmdb_show:1:s1\":{\"anilist:1\":{}}} trailing", "{\"tmdb_show:1:s1\":{\"anilist:1\":{}}"})
        {
            bool rejected = false;
            try { AnimeMappingIndex.Parse(new StringReader(invalid)); } catch (Exception) { rejected = true; }
            Assert(rejected, "Empty, trailing or truncated mapping rejected");
        }
        var items = new[] {
            new AnimeLocalItem {EmbyId=1, Name="Anime", AniListIds=new(){100,101,100}},
            new AnimeLocalItem {EmbyId=1, Name="Anime", AniListIds=new(){100,101}},
            new AnimeLocalItem {EmbyId=2, Name="Anime Movie", AniListIds=new(){102}},
            new AnimeLocalItem {EmbyId=3, Name="Unrelated", AniListIds=new(){999}}
        };
        var relations = new[]{new AnimeRelationRecord {Id=101, Relations=new(){
            new AnimeRelation {Id=102,Type="ANIME",Relation="SEQUEL"},
            new AnimeRelation {Id=999,Type="MANGA",Relation="SEQUEL"}}}};
        var groups=AnimeGroupPlanner.Plan(items,relations,true);
        Assert(groups.Count==1 && groups[0].EmbyIds.SequenceEqual(new long[]{1,2}), "TV seasons and film group with unique Emby members");
        foreach(var unsafeRelation in new[]{"OTHER","ADAPTATION","CHARACTER","ALTERNATIVE","ALTERNATIVE_VERSION","SUMMARY","COMPILATION","UNKNOWN"})
        {
            var edge = new[]{new AnimeRelationRecord {Id=100,Relations=new(){new AnimeRelation {Id=999,Type="ANIME",Relation=unsafeRelation}}}};
            Assert(AnimeGroupPlanner.Plan(new[]{items[0],items[3]},edge,true).Count==0, unsafeRelation+" excluded from groups");
        }
    }

    static async Task TestGraphExpansion()
    {
        var cache = new Dictionary<int, AnimeRelationRecord>();
        int calls=0, saves=0;
        Task<AnimeRelationRecord> Fetch(int id, CancellationToken token)
        {
            calls++;
            return Task.FromResult(new AnimeRelationRecord{Id=id,FetchedUtc=DateTime.UtcNow});
        }
        var partial = await AnimeGraphExpansion.ExpandAsync(new[]{1,2},1,100,14,true,cache,Fetch,()=>saves++,CancellationToken.None,_=>{});
        Assert(!partial.Complete, "Budget exhausted at final pending node MUST remain incomplete");
        Assert(partial.Records.Count==1 && calls==1 && saves==1, "Partial graph saves cache without pretending all seeds were read");
        var resumed = await AnimeGraphExpansion.ExpandAsync(new[]{1,2},1,100,14,true,cache,Fetch,()=>saves++,CancellationToken.None,_=>{});
        Assert(resumed.Complete && resumed.Records.Count==2 && resumed.NetworkRequests==1, "Next run resumes with cache and completes");
        var cached = await AnimeGraphExpansion.ExpandAsync(new[]{1,1,2,0,-1},0,100,14,true,cache,Fetch,()=>saves++,CancellationToken.None,_=>{});
        Assert(cached.Complete && cached.Records.Count==2 && cached.NetworkRequests==0, "Cached graph needs no network and deduplicates seeds");
        var zeroBudget = await AnimeGraphExpansion.ExpandAsync(new[]{3},0,100,14,true,cache,Fetch,()=>saves++,CancellationToken.None,_=>{});
        Assert(!zeroBudget.Complete && zeroBudget.Records.Count==0, "Zero budget cannot complete one uncached seed");
        var limited = await AnimeGraphExpansion.ExpandAsync(new[]{1,2},1,1,14,true,cache,Fetch,()=>saves++,CancellationToken.None,_=>{});
        Assert(!limited.Complete, "Graph node limit blocks completion");
        bool failed=false;
        try { await AnimeGraphExpansion.ExpandAsync(new[]{4},1,100,14,true,cache,
            (_,_)=>throw new HttpRequestException("Simulated 429 / server error"),()=>saves++,CancellationToken.None,_=>{}); }
        catch(HttpRequestException) { failed=true; }
        Assert(failed, "Fetch failure propagates instead of returning an empty successful graph");
        using var canceled=new CancellationTokenSource(); canceled.Cancel();
        bool stopped=false;
        try { await AnimeGraphExpansion.ExpandAsync(new[]{1},1,100,14,true,cache,Fetch,()=>saves++,canceled.Token,_=>{}); }
        catch(OperationCanceledException) { stopped=true; }
        Assert(stopped, "Cancellation propagates before graph is reported complete");
        cache[1].FetchedUtc=DateTime.UtcNow.AddDays(-30);
        var stale = await AnimeGraphExpansion.ExpandAsync(new[]{1},0,100,14,true,cache,Fetch,()=>saves++,CancellationToken.None,_=>{});
        Assert(!stale.Complete, "Stale cache cannot bypass request budget");
        var chain=Enumerable.Range(10,5).ToDictionary(id=>id,id=>new AnimeRelationRecord{
            Id=id,FetchedUtc=DateTime.UtcNow,Relations=new(){new AnimeRelation{Id=id+1,Type="ANIME",Relation="SEQUEL"}}});
        var bounded=await AnimeGraphExpansion.ExpandAsync(new[]{10},0,100,14,true,chain,Fetch,()=>{},CancellationToken.None,_=>{});
        Assert(bounded.Complete && bounded.Records.Select(r=>r.Id).SequenceEqual(new[]{10,11,12}), "Expansion stays within two hops");
    }

    static void TestOwnership()
    {
        var previous = new long[]{1,2};
        var desired = new long[]{1,3,4};
        var current = new long[]{1,2,3}; // 3 was manually added, 2 has uncertain mapping.
        var added = desired.Except(current).ToArray();
        var next = AnimeCollectionMembership.NextOwned(previous, added, Array.Empty<long>());
        Assert(next.SequenceEqual(new long[]{1,2,4}), "Manual existing desired member is not adopted; uncertain old owner retained");
        var removed = AnimeCollectionMembership.NextOwned(next, Array.Empty<long>(), new long[]{2});
        Assert(removed.SequenceEqual(new long[]{1,4}), "Confirmed removed member relinquishes ownership");
        Assert(AnimeCollectionMembership.NextOwned(previous,new long[]{2,4,4},Array.Empty<long>()).SequenceEqual(new long[]{1,2,4}), "Ownership deduplicated");
    }

    static AnimeLocalItem Item(long embyId, string name, bool series, int aniListId, params string[] providerIds) =>
        new AnimeLocalItem { EmbyId = embyId, Name = name, IsSeries = series,
            AniListIds = aniListId > 0 ? new() { aniListId } : new(),
            ProviderIds = providerIds.ToList() };

    static AnimeRelationRecord Relation(int from, int to, string relation = "SEQUEL") =>
        new AnimeRelationRecord { Id = from, Name = "Fixture", FetchedUtc = DateTime.UtcNow,
            Relations = new() { new AnimeRelation { Id = to, Type = "ANIME", Relation = relation } } };

    static void Reject(Action action, string name)
    {
        bool rejected = false;
        try { action(); }
        catch (InvalidDataException) { rejected = true; }
        Assert(rejected, name);
    }

    static void TestDuplicateDiagnostics()
    {
        var items = new[]
        {
            Item(1, "Movie A", false, 0, " TMDB_MOVIE:55 ", "IMDB_MOVIE:TT123", "tvdb_movie:77"),
            Item(2, "Movie copy", false, 0, "tmdb_movie:55", " imdb_movie:tt123 ", "TVDB_MOVIE:77"),
            Item(3, "Series A", true, 0, "tmdb_show:55", "imdb_show:tt123", "tvdb_show:77"),
            Item(4, "Series copy", true, 0, " TMDB_SHOW:55 ", "IMDB_SHOW:TT123", " tvdb_show:77 "),
            Item(5, "Separate movie", false, 0, "tmdb_movie:56")
        };
        var before = JsonSerializer.Serialize(items);
        var duplicates = AnimeCollectionPolicy.FindDuplicates(items);
        Assert(duplicates.Count == 6, "All three providers report movie and series duplicates separately");
        foreach (var type in new[] { "tmdb", "imdb", "tvdb" })
        {
            var id = type == "imdb" ? "tt123" : type == "tmdb" ? "55" : "77";
            Assert(duplicates.Single(d => d.Identifier == type + "_movie:" + id).EmbyIds.SequenceEqual(new long[] { 1, 2 }),
                type + " movie duplicate normalization and type isolation");
            Assert(duplicates.Single(d => d.Identifier == type + "_show:" + id).EmbyIds.SequenceEqual(new long[] { 3, 4 }),
                type + " series duplicate normalization and type isolation");
        }
        Assert(JsonSerializer.Serialize(items) == before, "Duplicate diagnostics never mutate or deduplicate local media");
        Assert(!AnimeCollectionPolicy.FindDuplicates(new[] { items[0] }).Any(), "One item's multiple providers are not duplicates");
        var repeated = Item(9, "Repeated metadata", false, 0, "tmdb_movie:55", " TMDB_MOVIE:55 ");
        Assert(!AnimeCollectionPolicy.FindDuplicates(new[] { repeated }).Any(), "Repeated provider on one media item is not a duplicate");
        var aggregateAndMovie = new[] {
            Item(12296, "鬼灭之刃", true, 178788, "tmdb_show:85937"),
            Item(18682, "无限城", false, 178788, "tmdb_movie:1311031")
        };
        Assert(!AnimeCollectionPolicy.FindDuplicates(aggregateAndMovie).Any(),
            "A multi-season series and a film sharing AniList identity are not duplicate provider media");
    }

    static AnimeLocalItem[] FateItems() => new[]
    {
        Item(101, "Fate/stay night", true, 356, "tmdb_show:1001"),
        Item(102, "Fate sequel", true, 19603, "tmdb_show:1002"),
        Item(103, "Fate branch", true, 10087, "tmdb_show:1003"),
        Item(104, "人参果", false, 9416, "tmdb_movie:453250", "imdb_movie:tt2572226")
    };

    static AnimeRelationRecord[] FateRelations() => new[]
    {
        Relation(356, 19603),
        Relation(356, 10087, "SPIN_OFF")
    };

    const string FateRules = """
        [{"Key":"anilist:356","IncludeIds":["anilist:356","tmdb_show:1002","anilist:10087"],"ExcludeIds":["tmdb_show:1003"]}]
        """;

    static void TestExactFateMembership()
    {
        var items = FateItems();
        foreach (bool includeSpinOffs in new[] { false, true })
        {
            var automatic = AnimeGroupPlanner.Plan(items, FateRelations(), includeSpinOffs);
            Assert(automatic.Count == 1 && automatic[0].ReviewRequired, "Known Fate branch requires review even with spin-offs disabled");
            var noRules = AnimeCollectionPolicy.Parse("", "anilist:356", "");
            Assert(!noRules.CanWrite(noRules.Apply(automatic, items).Single(), false),
                "Approving an ambiguous automatic Fate key cannot bypass explicit membership review");
            var policy = AnimeCollectionPolicy.Parse(FateRules, "anilist:356", "");
            var selected = policy.Apply(automatic, items);
            var fate = selected.Single(g => g.Key == "anilist:356");
            Assert(fate.EmbyIds.SequenceEqual(new long[] { 101, 102 }), "Fate IncludeIds is exact and ExcludeIds wins");
            Assert(fate.HasExplicitRule && policy.CanWrite(fate, false), "Explicit approved Fate selection can write outside DryRun");
            Assert(selected.All(g => !g.EmbyIds.Contains(103) && !g.EmbyIds.Contains(104)),
                "Fate branch and unrelated RenShenGuo cannot leak into residual automatic groups");
            Assert(!policy.CanWrite(fate, true), "DryRun blocks explicitly selected approved Fate");
        }
        var contaminated = AnimeGroupPlanner.Plan(items,
            FateRelations().Concat(new[] { Relation(10087, 9416) }), true);
        Assert(contaminated.Single().EmbyIds.Count == 4, "Contaminated automatic fixture includes both unselected branch members");
        var replaced = AnimeCollectionPolicy.Parse(FateRules, "anilist:356", "").Apply(contaminated, items);
        Assert(replaced.Count == 1 && replaced[0].EmbyIds.SequenceEqual(new long[] { 101, 102 }),
            "Explicit Fate rule replaces the whole automatic component without leaving a branch/RenShenGuo residual");
        var overlap = AnimeCollectionPolicy.Parse("""
            [{"Key":"anilist:356","IncludeIds":["anilist:356","anilist:19603"],"ExcludeIds":[]},
             {"Key":"anilist:10087","IncludeIds":["tmdb_show:1002","anilist:10087"],"ExcludeIds":[]}]
            """, "", "");
        Reject(() => overlap.Apply(AnimeGroupPlanner.Plan(items, FateRelations(), true), items),
            "Different typed identifiers resolving the same item in two rules fail closed");
    }

    static void TestApprovalAndAliases()
    {
        var items = new[]
        {
            Item(1, "Chainsaw Man", true, 127230), Item(2, "Chainsaw movie", false, 171627),
            Item(3, "Kono Subarashii", true, 21202), Item(4, "Kono sequel", true, 21699)
        };
        var automatic = AnimeGroupPlanner.Plan(items, new[] { Relation(127230, 171627), Relation(21202, 21699) }, true);
        var empty = AnimeCollectionPolicy.Parse("", "", "");
        var defaults = empty.Apply(automatic, items);
        Assert(defaults.Single(g => g.Key == "anilist:127230").Name == "电锯人", "Chainsaw default alias uses stable identity");
        Assert(defaults.Single(g => g.Key == "anilist:21202").Name == "为美好的世界献上祝福！", "KonoSuba default alias uses stable identity");
        Assert(defaults.All(g => !empty.CanWrite(g, false)), "Empty whitelist blocks writes when all DryRun flags are false");
        var approved = AnimeCollectionPolicy.Parse("", " \r\n anilist:127230 \r\n", """{"anilist:127230":"用户电锯人"}""");
        var renamed = approved.Apply(automatic, items);
        Assert(renamed.Single(g => g.Key == "anilist:127230").Name == "用户电锯人", "User alias overrides built-in alias");
        Assert(approved.CanWrite(renamed.Single(g => g.Key == "anilist:127230"), false), "Exact trimmed approval key permits renamed collection");
        Assert(!approved.CanWrite(renamed.Single(g => g.Key == "anilist:21202"), false), "Approving one key does not approve another");
        var sameName = new AnimeGroup { Anchor = 999, Key = "anilist:999", Name = "用户电锯人", EmbyIds = new() { 5, 6 } };
        Assert(!approved.CanWrite(sameName, false), "Matching approved display name never grants write permission");
        Assert(!approved.CanWrite(renamed.First(), true), "Global or anime DryRun blocks an otherwise approved group");
    }

    static void TestInvalidPolicies()
    {
        foreach (var rules in new[]
        {
            "{", "{}", "null",
            """[{"Key":"fate:mainline","IncludeIds":["anilist:356"],"ExcludeIds":[]}]""",
            """[{"Key":"anilist:0356","IncludeIds":["anilist:356"],"ExcludeIds":[]}]""",
            """[{"Key":"anilist:2147483648","IncludeIds":["anilist:356"],"ExcludeIds":[]}]""",
            """[{"Key":"anilist:356","IncludeIds":["movie:1"],"ExcludeIds":[]}]""",
            """[{"Key":"anilist:356","IncludeIds":["anilist:0"],"ExcludeIds":[]}]""",
            """[{"Key":"anilist:356","IncludeIds":[],"ExcludeIds":[],"Unexpected":true}]""",
            """[{"Key":"anilist:356","IncludeIds":[],"ExcludeIds":[]},{"Key":"anilist:356","IncludeIds":[],"ExcludeIds":[]}]"""
        })
            Reject(() => AnimeCollectionPolicy.Parse(rules, "", ""), "Invalid rules fail before planning or writes");
        foreach (var aliases in new[] { "{", "[]", """{"anilist:356":42}""", """{"anilist:356":""}""" })
            Reject(() => AnimeCollectionPolicy.Parse("", "", aliases), "Invalid alias configuration fails before writes");
        foreach (var approvals in new[] { "电锯人", "anilist:127230,anilist:21202", "ANILIST:127230", "anilist:0",
            "anilist:0356", "anilist:356\nanilist:356" })
            Reject(() => AnimeCollectionPolicy.Parse("", approvals, ""), "Malformed or display-name approval is rejected");
    }

    static void TestCacheRoundTrip()
    {
        const string legacy = """
            {"Id":356,"Name":"Fate/stay night","FetchedUtc":"2026-10-01T12:00:00Z",
             "Relations":[{"Id":19603,"Relation":"SEQUEL","Name":"Fate sequel","Type":"ANIME"}]}
            """;
        var record = JsonSerializer.Deserialize<AnimeRelationRecord>(legacy)!;
        var restored = JsonSerializer.Deserialize<AnimeRelationRecord>(JsonSerializer.Serialize(record))!;
        Assert(restored.Id == 356 && restored.Name == record.Name && restored.FetchedUtc == record.FetchedUtc,
            "Legacy relation cache DTO preserves identity, title and timestamp");
        Assert(restored.Relations.Single().Id == 19603 && restored.Relations.Single().Relation == "SEQUEL",
            "Legacy relation cache round-trip preserves typed graph edges");
        var cache = JsonSerializer.Deserialize<AnimeAiDecisionCache>(
            """{"Decisions":{"356:19603":{"Approved":false,"CheckedUtc":"2026-10-01T12:00:00Z"}}}""")!;
        var decisions = JsonSerializer.Deserialize<AnimeAiDecisionCache>(JsonSerializer.Serialize(cache))!;
        Assert(!decisions.Decisions["356:19603"].Approved &&
            decisions.Decisions["356:19603"].CheckedUtc == DateTime.Parse("2026-10-01T12:00:00Z").ToUniversalTime(),
            "Legacy AI cache retains denied review and checked timestamp");
    }

    static void TestOwnershipIdentityAndLegacyState()
    {
        Assert(AnimeCollectionPolicy.CanUseIdentity(null, null, Array.Empty<long>()),
            "A new identity without a name collision can be created");
        Assert(!AnimeCollectionPolicy.CanUseIdentity(null, 900, new long[] { 900 }),
            "An existing manual Fate collection cannot be adopted without owned identity");
        Assert(!AnimeCollectionPolicy.CanUseIdentity(null, null, new long[] { 900 }),
            "A same-name manual Fate collection blocks creation rather than being adopted");
        Assert(AnimeCollectionPolicy.CanUseIdentity(901, 901, new long[] { 901 }),
            "Previously owned identity is recognized by exact collection ID");
        Assert(!AnimeCollectionPolicy.CanUseIdentity(901, 900, new long[] { 900 }),
            "Same display name cannot substitute a different collection ID");
        Assert(!AnimeCollectionPolicy.CanUseIdentity(901, 901, new long[] { 901, 900 }),
            "A manual alias collision blocks updates to an otherwise owned collection");
        const string legacy = """
            {"Collections":[{"CollectionId":901,"Anchor":356,"Name":"Fate","ManagedItemIds":[101,102]}]}
            """;
        var state = JsonSerializer.Deserialize<AnimeCollectionState>(legacy)!;
        var before = JsonSerializer.Serialize(state);
        var group = new AnimeGroup { Key = "anilist:356", Anchor = 356, Name = "Fate", EmbyIds = new() { 101, 103 } };
        var denied = AnimeCollectionPolicy.Parse("", "", "");
        Assert(!denied.CanWrite(group, false), "Actual write predicate denies ownership updates for an unapproved existing group");
        var restored = JsonSerializer.Deserialize<AnimeCollectionState>(before)!;
        var collection = restored.Collections.Single();
        Assert(collection.CollectionId == 901 && collection.Anchor == 356 && collection.Name == "Fate",
            "Legacy owned collection identity and anchor survive round-trip without schema migration");
        Assert(collection.ManagedItemIds.SequenceEqual(new long[] { 101, 102 }),
            "Legacy owned membership round-trips unchanged");
        var unapprovedBranch = new AnimeGroup { Anchor = 10087, Key = "anilist:10087", Name = "Branch",
            ReviewRequired = true, EmbyIds = new() { 102, 104 } };
        Assert(!denied.CanWrite(unapprovedBranch, false), "Unapproved review-blocked branch is denied by production write predicate");
        Assert(AnimeCollectionPolicy.FindSplitCollectionIds(new[] { group, unapprovedBranch }, state.Collections).SetEquals(new long[] { 901 }),
            "Denied branch still reveals a split of the old owned collection");
        Assert(!AnimeCollectionPolicy.FindSplitCollectionIds(new[] { group }, state.Collections).Any(),
            "One resulting group alone is not a split");
        Assert(!AnimeCollectionPolicy.PlanRemovals(group, new long[] { 101, 102 },
            new long[] { 101, 102, 999 }, Array.Empty<long>()).Any(),
            "Automatic uncertainty retains previous ownership without an approved reassignment");
        Assert(AnimeCollectionPolicy.PlanRemovals(group, new long[] { 101, 102 },
            new long[] { 101, 102, 999 }, new long[] { 102, 999 }).SequenceEqual(new long[] { 102 }),
            "Automatic approved reassignment removes owned media only, never manual members");
        group.HasExplicitRule = true;
        Assert(AnimeCollectionPolicy.PlanRemovals(group, new long[] { 101, 102, 105 },
            new long[] { 101, 102, 999 }, Array.Empty<long>()).SequenceEqual(new long[] { 102 }),
            "Explicit exact selection removes excluded currently present owned members without adopting manual members");
    }

    static void TestConfigurationCompatibility()
    {
        var serializer = new System.Xml.Serialization.XmlSerializer(typeof(PluginConfiguration));
        using var legacyReader = new StringReader("""
            <PluginConfiguration>
              <AnimeEnabled>true</AnimeEnabled><AnimeDryRun>false</AnimeDryRun>
              <DryRunMode>false</DryRunMode><AnimeCollectionPrefix>旧动漫 · </AnimeCollectionPrefix>
            </PluginConfiguration>
            """);
        var config = (PluginConfiguration)serializer.Deserialize(legacyReader)!;
        Assert(config.AnimeEnabled && !config.AnimeDryRun && !config.DryRunMode &&
            config.AnimeCollectionPrefix == "旧动漫 · ", "Legacy XML retains existing configuration values");
        Assert(config.AnimeCollectionRulesJson == "" && config.AnimeApprovedCollectionKeys == "" &&
            config.AnimeCollectionAliasesJson == "", "Legacy XML defaults all new policy strings to empty");
        var local = FateItems();
        var legacyPolicy = AnimeCollectionPolicy.Parse(config.AnimeCollectionRulesJson,
            config.AnimeApprovedCollectionKeys, config.AnimeCollectionAliasesJson);
        Assert(legacyPolicy.Apply(AnimeGroupPlanner.Plan(local, FateRelations(), false), local)
            .All(g => !legacyPolicy.CanWrite(g, config.DryRunMode || config.AnimeDryRun)),
            "Legacy non-DryRun configuration cannot write without a new explicit whitelist");
        config.AnimeCollectionRulesJson = FateRules;
        config.AnimeApprovedCollectionKeys = "anilist:356\nanilist:127230";
        config.AnimeCollectionAliasesJson = """{"anilist:356":"命运 · 精选"}""";
        using var xml = new StringWriter();
        serializer.Serialize(xml, config);
        using var xmlReader = new StringReader(xml.ToString());
        var restored = (PluginConfiguration)serializer.Deserialize(xmlReader)!;
        Assert(restored.AnimeCollectionRulesJson == config.AnimeCollectionRulesJson &&
            restored.AnimeApprovedCollectionKeys == config.AnimeApprovedCollectionKeys &&
            restored.AnimeCollectionAliasesJson == config.AnimeCollectionAliasesJson,
            "Real configuration XML round-trip preserves rules, newline approvals and Chinese aliases");
        var jsonRestored = JsonSerializer.Deserialize<PluginConfiguration>(JsonSerializer.Serialize(config))!;
        Assert(jsonRestored.AnimeCollectionAliasesJson == config.AnimeCollectionAliasesJson &&
            jsonRestored.AnimeCollectionRulesJson == config.AnimeCollectionRulesJson &&
            jsonRestored.AnimeApprovedCollectionKeys == config.AnimeApprovedCollectionKeys,
            "Real configuration JSON round-trip preserves policy strings");
        var policy = AnimeCollectionPolicy.Parse(restored.AnimeCollectionRulesJson,
            restored.AnimeApprovedCollectionKeys, restored.AnimeCollectionAliasesJson);
        var fate = policy.Apply(AnimeGroupPlanner.Plan(local, FateRelations(), true), local).Single();
        Assert(fate.Name == "命运 · 精选" && policy.CanWrite(fate, restored.DryRunMode || restored.AnimeDryRun),
            "Round-tripped configuration drives the real exact-member write decision");
    }

    // Isolated simulated library: reported IDs are fixtures, not a live server scan.
    static AnimeLocalItem[] PreviewItems() => FateItems().Concat(new[]
    {
            Item(13946, "CLANNAD", true, 2167, "tmdb_show:24835", "imdb_show:tt1118804", "tvdb_show:80644"),
            Item(14144, "CLANNAD copy", true, 2167, "TMDB_SHOW:24835", "IMDB_SHOW:TT1118804", "TVDB_SHOW:80644"),
            Item(18682, "鬼灭之刃 无限城", false, 178788, "tmdb_movie:1311031", "imdb_movie:tt32820897"),
            Item(20454, "鬼灭之刃 无限城 copy", false, 178788, " TMDB_MOVIE:1311031 ", "imdb_movie:tt32820897"),
            new AnimeLocalItem { EmbyId = 12296, Name = "鬼灭之刃", IsSeries = true,
                AniListIds = new() { 101922, 112151, 129627, 129874, 142329, 145139, 154541, 166240, 178788 },
                ProviderIds = new() { "tmdb_show:85937", "tvdb_show:348545" } },
            Item(29881, "人参果", false, 9416, "tmdb_movie:453250", "imdb_movie:tt2572226"),
            Item(23944, "金猴降妖", false, 9417, "tmdb_movie:183340", "imdb_movie:tt2572208"),
            Item(11972, "チェンソーマン", true, 127230),
            Item(10991, "电锯人剧场版：蕾塞篇", false, 171627),
            Item(40001, "KonoSuba simulated season 1", true, 21202),
            Item(40002, "KonoSuba simulated season 2", true, 21699)
        }).Where(i => i.EmbyId != 104).ToArray();

    static AnimeRelationRecord[] PreviewRelations() => FateRelations().Concat(new[]
    {
        Relation(9416, 9417), Relation(127230, 171627), Relation(21202, 21699)
    }).ToArray();

    static void TestReportedLibraryCases()
    {
        var items = PreviewItems();
        var before = JsonSerializer.Serialize(items);
        var duplicates = AnimeCollectionPolicy.FindDuplicates(items);
        Assert(duplicates.Single(d => d.Identifier == "tmdb_show:24835").EmbyIds.SequenceEqual(new long[] { 13946, 14144 }),
            "Reported CLANNAD series copies warn by typed TMDB identity");
        Assert(duplicates.Single(d => d.Identifier == "imdb_show:tt1118804").EmbyIds.SequenceEqual(new long[] { 13946, 14144 }) &&
            duplicates.Single(d => d.Identifier == "tvdb_show:80644").EmbyIds.SequenceEqual(new long[] { 13946, 14144 }),
            "Reported CLANNAD duplicate warning retains both IMDb and TVDB evidence");
        Assert(duplicates.Single(d => d.Identifier == "tmdb_movie:1311031").EmbyIds.SequenceEqual(new long[] { 18682, 20454 }) &&
            duplicates.Single(d => d.Identifier == "imdb_movie:tt32820897").EmbyIds.SequenceEqual(new long[] { 18682, 20454 }),
            "Reported Demon Slayer movie copies retain both Emby identities in warning");
        var policy = AnimeCollectionPolicy.Parse(FateRules, "anilist:356\nanilist:127230\nanilist:21202", "");
        var groups = policy.Apply(AnimeGroupPlanner.Plan(items, PreviewRelations(), false), items);
        Assert(groups.Single(g => g.Key == "anilist:101922").EmbyIds.SequenceEqual(new long[] { 12296, 18682, 20454 }),
            "Demon Slayer duplicate diagnostics do not remove either movie from planned members");
        Assert(!groups.Single(g => g.Key == "anilist:356").EmbyIds.Contains(29881),
            "Reported RenShenGuo AniList 9416 never enters exact Fate membership");
        var unrelated = groups.Single(g => g.Key == "anilist:9416");
        Assert(unrelated.EmbyIds.SequenceEqual(new long[] { 23944, 29881 }) && !policy.CanWrite(unrelated, false),
            "Real RenShenGuo sequel link remains separate and unapproved, not adopted into Fate");
        Assert(groups.All(g => !policy.CanWrite(g, true)), "DryRun preview denies every real collection write");
        Assert(JsonSerializer.Serialize(items) == before, "Reported duplicate preview never mutates library fixture media");
    }

    static void PrintPreviewDemo()
    {
        var items = PreviewItems();
        var relations = PreviewRelations();
        var automatic = AnimeGroupPlanner.Plan(items, relations, false);
        var policy = AnimeCollectionPolicy.Parse(FateRules,
            "anilist:356\nanilist:127230\nanilist:21202", "");
        var groups = policy.Apply(automatic, items);
        var preview = new
        {
            Source = "ISOLATED SIMULATED LIBRARY — reported provider IDs plus explicit synthetic Fate/KonoSuba members; no server access",
            DryRun = true,
            AutomaticReview = automatic.Select(g => new { g.Key, g.ReviewRequired, Members = g.EmbyIds }),
            Groups = groups.Select(g => new
            {
                g.Key, g.Name, Members = g.EmbyIds, g.HasExplicitRule, g.ReviewRequired,
                ApprovedOutsideDryRun = policy.CanWrite(g, false),
                WritesAllowedNow = policy.CanWrite(g, true)
            }),
            Duplicates = AnimeCollectionPolicy.FindDuplicates(items)
        };
        Console.WriteLine(JsonSerializer.Serialize(preview, new JsonSerializerOptions { WriteIndented = true }));
    }
}
