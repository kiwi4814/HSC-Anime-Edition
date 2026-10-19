using MediaBrowser.Model.Logging;
using System;
using System.Collections.Generic;

namespace HomeScreenCompanion
{
    /// <summary>
    /// Shared writer for the live execution log shown on the plugin page.
    ///
    /// Every task keeps its own <c>ExecutionLog</c> list (the sink) which the status endpoints
    /// read; this class only decides how lines are formatted and which of them also reach the
    /// Emby server log. Status lines carry a leading symbol that the config page colours on:
    ///   ✔ ok · ⚠ warning · ✖ error · – skipped / informational
    /// Debug lines are written only when Extended log is enabled and never go to the server log.
    /// </summary>
    internal sealed class RunLog
    {
        public const string RuleLine = "══════════════════════════════════════════════════";

        private readonly List<string> _sink;
        private readonly ILogger? _logger;
        private readonly string _serverPrefix;

        public bool Extended { get; }

        public RunLog(List<string> sink, ILogger? logger, string serverLogPrefix, bool extended)
        {
            _sink = sink;
            _logger = logger;
            _serverPrefix = string.IsNullOrEmpty(serverLogPrefix) ? "" : serverLogPrefix + " ";
            Extended = extended;
        }

        // ── Status lines (always written) ────────────────────────────────────────

        /// <summary>Neutral line, no symbol. Used for headers, step lines and plain facts.</summary>
        public void Info(string message) => Write(message, LogSeverity.Info);

        /// <summary>Something completed successfully.</summary>
        public void Ok(string message) => Write("  ✔ " + message, LogSeverity.Info);

        /// <summary>Something needs the user's attention but the run continued.</summary>
        public void Warn(string message) => Write("  ⚠ " + message, LogSeverity.Warn);

        /// <summary>Something failed.</summary>
        public void Error(string message) => Write("  ✖ " + message, LogSeverity.Error);

        /// <summary>Something was deliberately not done (schedule, disabled, nothing to do).</summary>
        public void Skip(string message) => Write("  – " + message, LogSeverity.Info);

        /// <summary>Indented sub-line under a status line (e.g. a list of titles).</summary>
        public void Detail(string message) => Write("      " + message, LogSeverity.Info);

        public void Blank() => Write("", LogSeverity.None);

        public void Rule() => Write(RuleLine, LogSeverity.Info);

        // ── Debug lines (Extended log only) ───────────────────────────────────────

        public void Debug(string message)
        {
            if (!Extended) return;
            Add($"[{DateTime.Now:HH:mm:ss}] [DEBUG] {message}");
        }

        /// <summary>Debug section divider, e.g. "── Tags ────────".</summary>
        public void Section(string title)
        {
            if (!Extended) return;
            const int width = 50;
            var head = "── " + title + " ";
            Debug(head.Length >= width ? head : head + new string('─', width - head.Length));
        }

        // ── Internals ────────────────────────────────────────────────────────────

        private enum LogSeverity { None, Info, Warn, Error }

        private void Write(string line, LogSeverity severity)
        {
            Add($"[{DateTime.Now:HH:mm:ss}] {line}");
            if (_logger == null || severity == LogSeverity.None) return;
            var server = _serverPrefix + line.Trim();
            switch (severity)
            {
                case LogSeverity.Error: _logger.Error(server); break;
                case LogSeverity.Warn:  _logger.Warn(server);  break;
                default:                _logger.Info(server);  break;
            }
        }

        private void Add(string formatted)
        {
            lock (_sink) { _sink.Add(formatted); }
        }

        // ── Small formatting helpers shared by the tasks ─────────────────────────

        public static string Plural(int count, string unit)
            => $"{count} {unit}";

        public static string Elapsed(TimeSpan span)
        {
            if (span.TotalMinutes >= 1) return $"{(int)span.TotalMinutes} 分 {span.Seconds} 秒";
            if (span.TotalSeconds >= 10) return $"{(int)span.TotalSeconds} 秒";
            return $"{span.TotalSeconds:0.0} 秒";
        }
    }
}
