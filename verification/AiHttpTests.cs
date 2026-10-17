using System.Reflection;
using System.Text.Json;
using System.Xml.Serialization;
using HomeScreenCompanion;
using MediaBrowser.Model.Serialization;

static partial class Program
{
    internal const string FixtureSecret = "local-fixture-secret-not-a-credential";
    internal static IJsonSerializer TestJson() => DispatchProxy.Create<IJsonSerializer, FixtureJsonProxy>();
    static string ProviderEnvelope(string answer) => JsonSerializer.Serialize(new { choices = new[] { new { message = new { content = answer } } } });
    static PluginConfiguration AiConfig(string url) => new() { AnimeAiProvider = "OpenAICompatible", CompatibleAiBaseUrl = url, CompatibleAiModel = "fictional-model", CompatibleAiApiKey = FixtureSecret };

    static void TestAiConfigurationCompatibility(XmlSerializer serializer)
    {
        var defaults = new PluginConfiguration();
        Assert(defaults.AnimeAiProvider == "OpenAICompatible" && defaults.CompatibleAiBaseUrl == "" && defaults.CompatibleAiModel == "" && defaults.CompatibleAiApiKey == "", "New shared compatible configuration defaults empty");
        Assert(!defaults.AnimeAiNamingEnabled && !defaults.AnimeAiCollectionReviewEnabled && !defaults.AnimeAiReviewOtherEdges, "All AI capabilities default off");
        Assert(defaults.AnimeAiMaxCallsPerRun == 15 && defaults.AnimeAiMaxTokensPerCall == 800 && defaults.AnimeAiMaxTokensPerRun == 4000, "Default shared upper-bound budgets");
        foreach (var provider in new[] { "OpenAI", "Gemini", "Claude", "Ollama" })
        {
            using var reader = new StringReader($"<PluginConfiguration><AnimeAiProvider>{provider}</AnimeAiProvider><OpenAiModel>old-openai-model</OpenAiModel><GeminiModel>old-gemini-model</GeminiModel><ClaudeModel>old-claude-model</ClaudeModel><OllamaModel>old-ollama-model</OllamaModel></PluginConfiguration>");
            var legacy = (PluginConfiguration)serializer.Deserialize(reader)!;
            var json = JsonSerializer.Deserialize<PluginConfiguration>(JsonSerializer.Serialize(legacy))!;
            Assert(legacy.AnimeAiProvider == provider && json.AnimeAiProvider == provider && legacy.OpenAiModel == "old-openai-model" && json.GeminiModel == "old-gemini-model" && json.ClaudeModel == "old-claude-model" && json.OllamaModel == "old-ollama-model", "Explicit legacy provider/models retained: " + provider);
            Assert(!legacy.AnimeAiNamingEnabled && !legacy.AnimeAiCollectionReviewEnabled && !legacy.AnimeAiReviewOtherEdges, "Missing AI enable flags remain off for old XML");
        }
        var configured = AiConfig("http://127.0.0.1:19000/v1");
        configured.AnimeAiMaxCallsPerRun = 3; configured.AnimeAiMaxTokensPerCall = 123; configured.AnimeAiMaxTokensPerRun = 321;
        using var xml = new StringWriter(); serializer.Serialize(xml, configured); using var restoredReader = new StringReader(xml.ToString());
        var restored = (PluginConfiguration)serializer.Deserialize(restoredReader)!;
        Assert(restored.CompatibleAiBaseUrl == configured.CompatibleAiBaseUrl && restored.CompatibleAiModel == configured.CompatibleAiModel && restored.CompatibleAiApiKey == FixtureSecret && restored.AnimeAiMaxCallsPerRun == 3 && restored.AnimeAiMaxTokensPerCall == 123 && restored.AnimeAiMaxTokensPerRun == 321, "Shared credentials and limits XML round-trip");
    }

    static async Task ExpectAiError(Func<Task> operation, string category, string name)
    {
        AiRequestException? observed = null;
        try { await operation(); } catch (AiRequestException ex) { observed = ex; }
        Assert(observed?.Category == category, name);
        Assert(!observed!.Message.Contains(FixtureSecret, StringComparison.Ordinal) && !observed.Message.Contains("private-response-marker", StringComparison.Ordinal), "Errors never expose credentials or provider body");
    }

    static async Task TestAiHttpAndAnalysis()
    {
        var json = TestJson();
        var client = new AiRequestClient(json);
        await using (var server = new LocalHttpMock(_ => new(200, ProviderEnvelope("controlled-provider-result"))))
        {
            foreach (var suffix in new[] { "", "/", "/v1", "/gateway/v1/", "/v1/chat/completions", "/v1/chat/completions/" })
            {
                var config = AiConfig(server.Url + suffix);
                var answer = await client.CompleteAsync(config, config.AnimeAiProvider, "system-fixture", "user-fixture", 73, CancellationToken.None);
                var request = await server.NextAsync();
                var expected = suffix.StartsWith("/gateway", StringComparison.Ordinal) ? "/gateway/v1/chat/completions" : "/v1/chat/completions";
                Assert(answer == "controlled-provider-result" && request.Method == "POST" && request.Path == expected, "Real HTTP root/base/full completion endpoint round-trip: " + suffix);
                Assert(request.Headers["Authorization"] == "Bearer " + FixtureSecret && request.Headers["Content-Type"].StartsWith("application/json", StringComparison.Ordinal), "Real HTTP Bearer and JSON request headers");
                using var body = JsonDocument.Parse(request.Body); var root = body.RootElement;
                Assert(root.GetProperty("model").GetString() == "fictional-model" && root.GetProperty("max_tokens").GetInt32() == 73 && !root.GetProperty("stream").GetBoolean(), "Real HTTP model/output bound/nonstream payload");
                var messages = root.GetProperty("messages");
                Assert(messages.GetArrayLength() == 2 && messages[0].GetProperty("role").GetString() == "system" && messages[0].GetProperty("content").GetString() == "system-fixture" && messages[1].GetProperty("role").GetString() == "user" && messages[1].GetProperty("content").GetString() == "user-fixture", "Real HTTP role-separated messages");
            }
        }
        Assert(AiRequestClient.NormalizeCompatibleEndpoint("http://192.168.50.10:19000/v1").AbsoluteUri == "http://192.168.50.10:19000/v1/chat/completions", "LAN HTTP endpoint accepted without making a LAN request");
        Assert(AiRequestClient.HttpWarning(AiConfig("http://192.168.50.10:19000/v1"), "OpenAICompatible").Length > 0 && AiRequestClient.HttpWarning(AiConfig("https://example.invalid/v1"), "OpenAICompatible") == "", "HTTP transport warning distinguishes cleartext");
        foreach (var invalid in new[] { "file:///tmp/mock", "ftp://localhost/v1", "http://user:password@localhost/v1", "http://localhost/v1?key=secret", "http://localhost/v1#fragment", "relative/path" })
            await ExpectAiError(() => Task.FromResult(AiRequestClient.NormalizeCompatibleEndpoint(invalid)), "configuration", "Invalid endpoint rejected offline");
        foreach (var pair in new[] { (401, "unauthorized"), (403, "unauthorized"), (429, "rate_limit"), (500, "server"), (503, "server"), (400, "http") })
        {
            await using var server = new LocalHttpMock(_ => new(pair.Item1, "private-response-marker " + FixtureSecret));
            var config = AiConfig(server.Url);
            await ExpectAiError(() => client.CompleteAsync(config, config.AnimeAiProvider, "s", "u", 50, CancellationToken.None), pair.Item2, "Real HTTP classified status " + pair.Item1);
            Assert(server.RequestCount == 1, "HTTP failure does not retry or spend extra calls");
        }
        foreach (var invalid in new[] { "{not-json", "{}", "{\"choices\":[]}", ProviderEnvelope("") })
        {
            await using var server = new LocalHttpMock(_ => new(200, invalid)); var config = AiConfig(server.Url);
            await ExpectAiError(() => client.CompleteAsync(config, config.AnimeAiProvider, "s", "u", 50, CancellationToken.None), "invalid_json", "Real HTTP invalid/missing message JSON rejected");
        }
        await using (var sink = new LocalHttpMock(_ => new(200, ProviderEnvelope("unexpected"))))
        await using (var redirect = new LocalHttpMock(_ => new(307, "private-response-marker", sink.Url + "/capture")))
        {
            var config = AiConfig(redirect.Url);
            await ExpectAiError(() => client.CompleteAsync(config, config.AnimeAiProvider, "s", "u", 50, CancellationToken.None), "http", "Default production transport rejects redirects");
            Assert(redirect.RequestCount == 1 && sink.RequestCount == 0, "Redirect destination receives no request or credentials");
        }
        await using (var oversized = new LocalHttpMock(_ => new(200, new string('x', AiRequestClient.MaxBodyBytes + 1))))
        {
            var config = AiConfig(oversized.Url);
            await ExpectAiError(() => client.CompleteAsync(config, config.AnimeAiProvider, "s", "u", 50, CancellationToken.None), "invalid_json", "Real HTTP oversized response rejected before parsing");
            int before = oversized.RequestCount;
            await ExpectAiError(() => client.CompleteAsync(config, config.AnimeAiProvider, "s", new string('x', AiRequestClient.MaxBodyBytes + 1), 50, CancellationToken.None), "configuration", "Oversized request rejected before send");
            Assert(oversized.RequestCount == before, "Request bound prevents spending an HTTP call");
        }
        using (var transport = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }))
        await using (var slow = new LocalHttpMock(_ => new(200, ProviderEnvelope("late"), Delay: TimeSpan.FromSeconds(5))))
        {
            var config = AiConfig(slow.Url); var shortClient = new AiRequestClient(json, transport, TimeSpan.FromMilliseconds(200));
            await ExpectAiError(() => shortClient.CompleteAsync(config, config.AnimeAiProvider, "s", "u", 50, CancellationToken.None), "timeout", "Real HTTP delayed response timeout");
            await slow.NextAsync();
            using var cancel = new CancellationTokenSource();
            var pending = client.CompleteAsync(config, config.AnimeAiProvider, "s", "u", 50, cancel.Token);
            await slow.NextAsync(); cancel.Cancel(); bool stopped = false;
            try { await pending; } catch (OperationCanceledException) { stopped = true; }
            Assert(stopped, "Caller cancellation remains cancellation, not successful result or timeout");
            using var alreadyCanceled = new CancellationTokenSource(); alreadyCanceled.Cancel();
            int before = slow.RequestCount; stopped = false;
            try { await client.CompleteAsync(config, config.AnimeAiProvider, "s", "u", 50, alreadyCanceled.Token); } catch (OperationCanceledException) { stopped = true; }
            Assert(stopped && slow.RequestCount == before, "Pre-cancel prevents HTTP send");
        }
        await TestAnalysisCapabilities();
        await TestMetadataOnlyAnalysis();
        TestBackupSecrets();
    }
}

// Only Emby's serialization boundary is adapted. HTTP and production validation execute unchanged.
public class FixtureJsonProxy : DispatchProxy
{
    private static readonly System.Text.Json.JsonSerializerOptions Options = new() { PropertyNameCaseInsensitive = true, IncludeFields = true };
    protected override object? Invoke(MethodInfo? method, object?[]? args)
    {
        if (method == null || args == null) throw new InvalidOperationException();
        switch (method.Name)
        {
            case "SerializeToString": return JsonSerializer.Serialize(args[0], args[0]?.GetType() ?? typeof(object), Options);
            case "DeserializeFromString": return JsonSerializer.Deserialize((string)args[0]!, method.GetGenericArguments().Single(), Options);
            case "DeserializeFromFile": return JsonSerializer.Deserialize(File.ReadAllText((string)args[0]!), method.GetGenericArguments().Single(), Options);
            case "SerializeToFile": File.WriteAllText((string)args[1]!, JsonSerializer.Serialize(args[0], args[0]?.GetType() ?? typeof(object), Options)); return null;
            default: throw new NotSupportedException("Unexpected serializer call: " + method.Name);
        }
    }
}
