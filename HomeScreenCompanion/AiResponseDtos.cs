using System.Collections.Generic;

namespace HomeScreenCompanion
{
    // AI source DTOs

    public class OpenAiResponse
    {
        public List<OpenAiChoice> choices { get; set; } = new List<OpenAiChoice>();
    }

    public class OpenAiChoice
    {
        public OpenAiMessage message { get; set; } = new OpenAiMessage();
    }

    public class OpenAiMessage
    {
        public string role { get; set; } = "";
        public string content { get; set; } = "";
    }

    public class GeminiResponse
    {
        public List<GeminiCandidate> candidates { get; set; } = new List<GeminiCandidate>();
    }

    public class GeminiCandidate
    {
        public GeminiContent content { get; set; } = new GeminiContent();
    }

    public class GeminiContent
    {
        public List<GeminiPart> parts { get; set; } = new List<GeminiPart>();
    }

    public class GeminiPart
    {
        public string text { get; set; } = "";
    }

    public class OllamaResponse
    {
        public OllamaMessage message { get; set; } = new OllamaMessage();
    }

    public class OllamaMessage
    {
        public string role { get; set; } = "";
        public string content { get; set; } = "";
    }

    public class ClaudeResponse
    {
        public List<ClaudeContent> content { get; set; } = new List<ClaudeContent>();
    }

    public class ClaudeContent
    {
        public string type { get; set; } = "";
        public string text { get; set; } = "";
    }
}
