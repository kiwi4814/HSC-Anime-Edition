using HomeScreenCompanion;

static class Program
{
    private static int _passed;
    static int Main()
    {
        try
        {
            TestMappings();
            TestGroups();
            TestAdditionalMappingsAndGroups();
            TestOwnership();
            TestGraphExpansion().GetAwaiter().GetResult();
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
}
