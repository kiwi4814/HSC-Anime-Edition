using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Model.Serialization;

namespace HomeScreenCompanion
{
    internal sealed class AiRequestException : Exception
    {
        public string Category { get; }
        public AiRequestException(string category, string message) : base(message) { Category = category; }
    }

    // Every provider shares bounded transport. Never include response bodies, URLs or keys in errors.
    internal sealed class AiRequestClient
    {
        private static readonly HttpClient SharedClient = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false });
        private readonly HttpClient _client;
        private readonly IJsonSerializer _json;
        private readonly TimeSpan _timeout;
        internal static string CleanAiJsonOutput(string raw)
        {
            var trimmed = (raw ?? "").Trim();
            if (trimmed.StartsWith("```", StringComparison.Ordinal))
            {
                var firstNewline = trimmed.IndexOf('\n');
                var lastFence = trimmed.LastIndexOf("```", StringComparison.Ordinal);
                if (firstNewline > 0 && lastFence > firstNewline)
                    trimmed = trimmed.Substring(firstNewline + 1, lastFence - firstNewline - 1).Trim();
            }
            return trimmed;
        }
        internal const int MaxBodyBytes = 256 * 1024;
        public AiRequestClient(IJsonSerializer serializer, HttpClient? client = null, TimeSpan? timeout = null)
        { _json = serializer; _client = client ?? SharedClient; _timeout = timeout ?? TimeSpan.FromSeconds(30); }

        public static Uri NormalizeCompatibleEndpoint(string baseUrl)
        {
            if (!Uri.TryCreate((baseUrl ?? "").Trim(), UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) ||
                string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo) ||
                !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
                throw new AiRequestException("configuration", "AI 接口地址无效，请填写 http:// 或 https:// 开头的地址（不要包含用户名、密码或 ? # 后的部分）。");
            var path = uri.AbsolutePath.TrimEnd('/');
            if (!path.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase))
                path += path.Length == 0 ? "/v1/chat/completions" : "/chat/completions";
            return new UriBuilder(uri) { Path = path }.Uri;
        }

        public static string HttpWarning(PluginConfiguration config, string provider)
        {
            var url = provider.Equals("Ollama", StringComparison.OrdinalIgnoreCase) ? config.OllamaBaseUrl :
                provider.Equals("OpenAICompatible", StringComparison.OrdinalIgnoreCase) ? config.CompatibleAiBaseUrl : "";
            return Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == "http"
                ? "AI 接口使用 HTTP，请求内容和密钥会以明文传输，请只在本机或可信局域网中使用。" : "";
        }

        public static string Model(PluginConfiguration c, string? provider)
        {
            switch ((provider ?? "").Trim().ToUpperInvariant())
            {
                case "OPENAICOMPATIBLE": return c.CompatibleAiModel ?? "";
                case "OPENAI": return c.OpenAiModel ?? "";
                case "GEMINI": return c.GeminiModel ?? "";
                case "CLAUDE": return c.ClaudeModel ?? "";
                case "OLLAMA": return c.OllamaModel ?? "";
                default: throw new AiRequestException("configuration", "不支持所选 AI 提供商。");
            }
        }

        public async Task<string> CompleteAsync(PluginConfiguration c, string provider, string system, string user, int maxTokens, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            provider = (provider ?? "").Trim();
            var model = Model(c, provider);
            if (string.IsNullOrWhiteSpace(model)) throw new AiRequestException("configuration", "尚未配置 AI 模型。");
            if (maxTokens <= 0) throw new AiRequestException("configuration", "AI 输出 Token 上限必须大于零。");
            var messages = new[] { new { role = "system", content = system }, new { role = "user", content = user } };
            Uri endpoint;
            object body;
            string key = "";
            string kind = provider.ToUpperInvariant();
            switch (kind)
            {
                case "OPENAICOMPATIBLE":
                case "OPENAI":
                    endpoint = kind == "OPENAI" ? new Uri("https://api.openai.com/v1/chat/completions") : NormalizeCompatibleEndpoint(c.CompatibleAiBaseUrl);
                    key = kind == "OPENAI" ? c.OpenAiApiKey : c.CompatibleAiApiKey;
                    body = new { model, messages, stream = false, max_tokens = maxTokens };
                    break;
                case "GEMINI":
                    key = c.GeminiApiKey;
                    endpoint = new Uri("https://generativelanguage.googleapis.com/v1beta/models/" + Uri.EscapeDataString(model) + ":generateContent");
                    body = new { systemInstruction = new { parts = new[] { new { text = system } } }, contents = new[] { new { role = "user", parts = new[] { new { text = user } } } }, generationConfig = new { maxOutputTokens = maxTokens } };
                    break;
                case "CLAUDE":
                    key = c.ClaudeApiKey;
                    endpoint = new Uri("https://api.anthropic.com/v1/messages");
                    body = new { model, max_tokens = maxTokens, system, messages = new[] { new { role = "user", content = user } } };
                    break;
                case "OLLAMA":
                    if (!Uri.TryCreate((c.OllamaBaseUrl ?? "").TrimEnd('/') + "/api/chat", UriKind.Absolute, out var ollamaEndpoint) ||
                        (ollamaEndpoint.Scheme != "http" && ollamaEndpoint.Scheme != "https") || !string.IsNullOrEmpty(ollamaEndpoint.UserInfo) || !string.IsNullOrEmpty(ollamaEndpoint.Query) || !string.IsNullOrEmpty(ollamaEndpoint.Fragment))
                        throw new AiRequestException("configuration", "Ollama 接口地址无效。");
                    endpoint = ollamaEndpoint;
                    body = new { model, messages, stream = false, options = new { num_predict = maxTokens } };
                    break;
                default: throw new AiRequestException("configuration", "不支持所选 AI 提供商。");
            }
            if (kind != "OLLAMA" && string.IsNullOrWhiteSpace(key)) throw new AiRequestException("configuration", "尚未配置所选 AI 提供商的 API 密钥。");
            try
            {
                using (var linked = CancellationTokenSource.CreateLinkedTokenSource(token))
                using (var request = new HttpRequestMessage(HttpMethod.Post, endpoint))
                {
                    linked.CancelAfter(_timeout);
                    if (kind == "GEMINI") request.Headers.Add("x-goog-api-key", key);
                    else if (kind == "CLAUDE") { request.Headers.Add("x-api-key", key); request.Headers.Add("anthropic-version", "2023-06-01"); }
                    else if (kind != "OLLAMA") request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
                    var json = _json.SerializeToString(body);
                    if (Encoding.UTF8.GetByteCount(json) > MaxBodyBytes) throw new AiRequestException("configuration", "AI 请求内容超过大小限制。");
                    request.Content = new StringContent(json, Encoding.UTF8, "application/json");
                    using (var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, linked.Token).ConfigureAwait(false))
                    {
                        int status = (int)response.StatusCode;
                        if (status == 401 || status == 403) throw new AiRequestException("unauthorized", "AI 身份验证失败，请检查密钥和访问权限。");
                        if (status == 429) throw new AiRequestException("rate_limit", "AI 请求受限或额度不足，请稍后重试。");
                        if (status >= 500) throw new AiRequestException("server", "AI 服务暂时不可用。");
                        if (!response.IsSuccessStatusCode) throw new AiRequestException("http", "AI 接口返回异常状态（" + status + "）。");
                        string raw = await ReadBoundedAsync(response.Content, linked.Token).ConfigureAwait(false);
                        try
                        {
                            string? answer;
                            if (kind == "GEMINI") answer = _json.DeserializeFromString<GeminiResponse>(raw)?.candidates?.FirstOrDefault()?.content?.parts?.FirstOrDefault()?.text;
                            else if (kind == "CLAUDE") answer = _json.DeserializeFromString<ClaudeResponse>(raw)?.content?.FirstOrDefault(p => p.type == "text")?.text;
                            else if (kind == "OLLAMA") answer = _json.DeserializeFromString<OllamaResponse>(raw)?.message?.content;
                            else answer = _json.DeserializeFromString<OpenAiResponse>(raw)?.choices?.FirstOrDefault()?.message?.content;
                            if (string.IsNullOrWhiteSpace(answer)) throw new FormatException();
                            return answer!;
                        }
                        catch { throw new AiRequestException("invalid_json", "AI 响应不是有效的消息 JSON。"); }
                    }
                }
            }
            catch (AiRequestException) { throw; }
            catch (OperationCanceledException) { token.ThrowIfCancellationRequested(); throw new AiRequestException("timeout", "AI 请求超时。"); }
            catch { throw new AiRequestException("network", "无法连接 AI 接口，请检查地址与网络设置。"); }
        }

        private static async Task<string> ReadBoundedAsync(HttpContent content, CancellationToken token)
        {
            if (content.Headers.ContentLength > MaxBodyBytes) throw new AiRequestException("invalid_json", "AI 响应超过大小限制。");
            using (var stream = await content.ReadAsStreamAsync().ConfigureAwait(false))
            using (var output = new MemoryStream())
            {
                var buffer = new byte[4096];
                while (true)
                {
                    int count = await stream.ReadAsync(buffer, 0, buffer.Length, token).ConfigureAwait(false);
                    if (count == 0) break;
                    if (output.Length + count > MaxBodyBytes) throw new AiRequestException("invalid_json", "AI 响应超过大小限制。");
                    output.Write(buffer, 0, count);
                }
                return Encoding.UTF8.GetString(output.GetBuffer(), 0, (int)output.Length);
            }
        }
    }
}
