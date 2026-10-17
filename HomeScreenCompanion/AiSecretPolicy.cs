namespace HomeScreenCompanion
{
    internal static class AiSecretPolicy
    {
        // Credentials never leave the server in a backup; blank imported fields preserve saved values.
        public static string ExportKey(string? key) => "";
        public static string PreserveImported(string? incoming, string current) =>
            string.IsNullOrWhiteSpace(incoming) ? current : incoming!;
        public static void PreserveMissing(PluginConfiguration incoming, PluginConfiguration current)
        {
            incoming.CompatibleAiApiKey = PreserveImported(incoming.CompatibleAiApiKey, current.CompatibleAiApiKey);
            incoming.OpenAiApiKey = PreserveImported(incoming.OpenAiApiKey, current.OpenAiApiKey);
            incoming.GeminiApiKey = PreserveImported(incoming.GeminiApiKey, current.GeminiApiKey);
            incoming.ClaudeApiKey = PreserveImported(incoming.ClaudeApiKey, current.ClaudeApiKey);
        }
    }
}
