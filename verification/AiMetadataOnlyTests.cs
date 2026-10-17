using System.Text.Json;
using HomeScreenCompanion;

static partial class Program
{
    static async Task TestMetadataOnlyAnalysis()
    {
        foreach (bool sharedProvider in new[] { true, false })
        {
            var items = new List<AnimeLocalItem> {
                Item(401, "云梯校舍 上卷", true, 1900000701, "tmdb_show:1900000801"),
                Item(402, "云梯校舍 下卷", true, sharedProvider ? 1900000702 : 1900000701, sharedProvider ? "tmdb_show:1900000801" : "tmdb_show:1900000802") };
            var groups = new List<AnimeGroup> { new() { Anchor = 1900000701, Name = "云梯校舍", HasExplicitRule = true, EmbyIds = new() { 401, 402 } } };
            var before = JsonSerializer.Serialize(new { items, groups });
            var ids = sharedProvider ? new[] { 1900000701, 1900000702 } : new[] { 1900000701 };
            // Controlled provider replies are built from fixture constants, not request data.
            var naming = JsonSerializer.Serialize(new {
                Kind = "naming", GroupKey = "anilist:1900000701", SuggestedName = sharedProvider ? "模型提出的未核实名称" : "云梯校舍", Decision = "suggest", Reason = "仅建议人工查证。", Confidence = 0.95,
                EmbyIds = new long[] { 401, 402 }, AniListIds = ids, Evidence = Array.Empty<AnimeAiEvidence>() });
            var review = JsonSerializer.Serialize(new {
                Kind = "review", GroupKey = "anilist:1900000701", SuggestedName = "", Decision = "keep", Reason = "输入仅能支持元数据审查，不确认新的成员关系。", Confidence = 0.8,
                EmbyIds = new long[] { 401, 402 }, AniListIds = ids, Evidence = Array.Empty<AnimeAiEvidence>(),
                ReviewIssues = sharedProvider ? new[] { new AnimeAiReviewIssue { IssueType = "duplicate", EmbyIds = new() { 401, 402 }, Reason = "同类型来源编号相同。", RiskLevel = "high", RecommendedAction = "人工核对，不自动删除。", Confidence = 0.9 } } : Array.Empty<AnimeAiReviewIssue>() });
            await using var server = new LocalHttpMock(request => new(200, ProviderEnvelope(RequestKind(request) == "naming" ? naming : review)));
            var config = AnalysisConfig(server.Url); config.AnimeAiReviewOtherEdges = false;
            using var dir = new Scratch(); var analysis = new AnimeAiAnalysisService(TestJson());
            await analysis.AnalyzeAsync(config, items, new(), groups, dir.Dir, CancellationToken.None, _ => { });
            var result = analysis.Read(dir.Dir);
            Assert(server.RequestCount == 2 && result.Suggestions.Count == 2, "Metadata-only explicit groups receive real naming/review HTTP analysis without relation edges");
            var named = result.Suggestions.Single(s => s.Kind == "naming");
            Assert(named.AdvisoryOnly && named.OriginalName == "云梯校舍" && named.HasExplicitRule, "Metadata-only naming remains advisory with original name and custom-rule provenance");
            Assert(sharedProvider ? named.NameEvidenceStatus == "unverified" && named.Confidence <= 0.49 : named.NameEvidenceStatus == "derived_prefix" && named.Confidence == 0.95, "Naming distinguishes unsupported confidence-capped output from an input-derived common prefix");
            var reviewed = result.Suggestions.Single(s => s.Kind == "review");
            if (sharedProvider)
            {
                Assert(reviewed.DuplicateCandidates.Single().SequenceEqual(new long[] { 401, 402 }) && reviewed.ProviderEvidence.Single().ProviderId == "tmdb_show:1900000801" && reviewed.ProviderEvidence.Single().EmbyIds.SequenceEqual(new long[] { 401, 402 }), "No-edge duplicate review has actual typed-provider provenance");
            }
            else
            {
                Assert(reviewed.DuplicateCandidates.Count == 0 && reviewed.ProviderEvidence.Count == 0, "AniList overlap alone is never presented as duplicate-provider evidence");
            }
            Assert(reviewed.Evidence.Count == 0 && JsonSerializer.Serialize(new { items, groups }) == before, "Metadata-only review invents no graph evidence and never applies names or memberships");
        }
    }
}
