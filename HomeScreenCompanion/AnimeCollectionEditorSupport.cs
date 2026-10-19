using System;
using System.IO;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace HomeScreenCompanion
{
    /// <summary>
    /// Visual collection editor helpers (P2): rewrite exact rules/aliases JSON and
    /// pick include identifiers from scanned local items. BaseItem lookups stay in the service.
    /// </summary>
    internal static class AnimeCollectionEditorSupport
    {
        internal static string UpsertExactRule(string rulesJson, string key, IEnumerable<string> includeIds)
        {
            var include = NormalizeIncludeIds(includeIds);
            var policy = AnimeCollectionPolicy.Parse(rulesJson ?? "", "", "");
            var entries = policy.ExportRules()
                .Where(r => !string.Equals(r.Key, key, StringComparison.Ordinal))
                .ToList();
            entries.Add(new AnimeExactRuleSnapshot { Key = key, IncludeIds = include, ExcludeIds = new List<string>() });
            string json = WriteRulesJson(entries);
            AnimeCollectionPolicy.Parse(json, "", "");
            return json;
        }

        internal static string RemoveExactRule(string rulesJson, string key)
        {
            var policy = AnimeCollectionPolicy.Parse(rulesJson ?? "", "", "");
            var entries = policy.ExportRules()
                .Where(r => !string.Equals(r.Key, key, StringComparison.Ordinal))
                .ToList();
            if (entries.Count == 0) return "";
            string json = WriteRulesJson(entries);
            AnimeCollectionPolicy.Parse(json, "", "");
            return json;
        }

        internal static string UpsertAlias(string aliasesJson, string key, string displayName)
        {
            var name = (displayName ?? "").Trim();
            if (string.IsNullOrEmpty(name) || name.Any(char.IsControl))
                throw new InvalidDataException("显示名称不能为空。");
            var policy = AnimeCollectionPolicy.Parse("", "", aliasesJson ?? "");
            var map = policy.ExportAliases();
            map[key] = name;
            string json = WriteAliasesJson(map);
            AnimeCollectionPolicy.Parse("", "", json);
            return json;
        }

        /// <summary>
        /// When the optional approval list is non-empty, ensure this key is listed.
        /// Empty list stays empty (auto-allow all).
        /// </summary>
        internal static string EnsureApprovedKey(string approvedKeys, string key)
        {
            var policy = AnimeCollectionPolicy.Parse("", approvedKeys ?? "", "");
            var approved = policy.ExportApproved();
            if (approved.Count == 0) return approvedKeys ?? "";
            approved.Add(key);
            string next = NormalizeApproved(approved);
            AnimeCollectionPolicy.Parse("", next, "");
            return next;
        }

        internal static List<string> NormalizeIncludeIds(IEnumerable<string> includeIds)
        {
            var include = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var raw in includeIds ?? Array.Empty<string>())
            {
                var id = (raw ?? "").Trim();
                if (!AnimeCollectionPolicy.IsIdentifier(id))
                    throw new InvalidDataException("无法识别的媒体编号。");
                if (!seen.Add(id))
                    throw new InvalidDataException("成员重复。");
                include.Add(id);
            }
            return include;
        }

        internal static string? PrimaryIncludeId(AnimeLocalItem item)
        {
            if (item == null) return null;
            if (item.AniListIds != null && item.AniListIds.Count > 0)
            {
                int min = item.AniListIds.Where(id => id > 0).DefaultIfEmpty(0).Min();
                if (min > 0) return "anilist:" + min.ToString(CultureInfo.InvariantCulture);
            }
            return PreferProvider(item.ProviderIds);
        }

        private static string? PreferProvider(IEnumerable<string>? ids)
        {
            if (ids == null) return null;
            var list = ids.Where(id => AnimeCollectionPolicy.IsIdentifier(id)).Distinct(StringComparer.Ordinal).ToList();
            if (list.Count == 0) return null;
            string[] order = { "tmdb_", "imdb_", "tvdb_" };
            foreach (var prefix in order)
            {
                var hit = list.Where(id => id.StartsWith(prefix, StringComparison.Ordinal))
                    .OrderBy(id => id, StringComparer.Ordinal).FirstOrDefault();
                if (hit != null) return hit;
            }
            return list.OrderBy(id => id, StringComparer.Ordinal).FirstOrDefault();
        }

        private static string NormalizeApproved(HashSet<string> keys) =>
            string.Join("\n", keys.OrderBy(ParseAnchorSafe).ThenBy(k => k, StringComparer.Ordinal));

        private static int ParseAnchorSafe(string key)
        {
            if (key != null && key.StartsWith("anilist:", StringComparison.Ordinal) &&
                int.TryParse(key.Substring(8), NumberStyles.None, CultureInfo.InvariantCulture, out var n))
                return n;
            return int.MaxValue;
        }

        private static string WriteRulesJson(List<AnimeExactRuleSnapshot> rules)
        {
            var ordered = rules.OrderBy(r => ParseAnchorSafe(r.Key)).ThenBy(r => r.Key, StringComparer.Ordinal).ToList();
            var sb = new StringBuilder();
            sb.Append('[');
            for (int i = 0; i < ordered.Count; i++)
            {
                if (i > 0) sb.Append(',');
                var r = ordered[i];
                sb.Append("{\"Key\":").Append(JsonString(r.Key));
                sb.Append(",\"IncludeIds\":[");
                var ids = (r.IncludeIds ?? new List<string>()).OrderBy(id => id, StringComparer.Ordinal).ToList();
                for (int j = 0; j < ids.Count; j++)
                {
                    if (j > 0) sb.Append(',');
                    sb.Append(JsonString(ids[j]));
                }
                sb.Append(']');
                var ex = (r.ExcludeIds ?? new List<string>()).Where(id => !string.IsNullOrEmpty(id)).OrderBy(id => id, StringComparer.Ordinal).ToList();
                if (ex.Count > 0)
                {
                    sb.Append(",\"ExcludeIds\":[");
                    for (int j = 0; j < ex.Count; j++)
                    {
                        if (j > 0) sb.Append(',');
                        sb.Append(JsonString(ex[j]));
                    }
                    sb.Append(']');
                }
                sb.Append('}');
            }
            sb.Append(']');
            return sb.ToString();
        }

        private static string WriteAliasesJson(Dictionary<string, string> aliases)
        {
            var sb = new StringBuilder();
            sb.Append('{');
            bool first = true;
            foreach (var pair in aliases.OrderBy(p => ParseAnchorSafe(p.Key)).ThenBy(p => p.Key, StringComparer.Ordinal))
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append(JsonString(pair.Key)).Append(':').Append(JsonString(pair.Value));
            }
            sb.Append('}');
            return sb.ToString();
        }

        private static string JsonString(string value)
        {
            var sb = new StringBuilder();
            sb.Append('"');
            foreach (char c in value ?? "")
            {
                switch (c)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }
        internal static string AddDiscardedKey(string discardedKeys, string key)
        {
            key = (key ?? "").Trim();
            if (!AnimeCollectionPolicy.IsIdentifier(key))
                throw new InvalidDataException("无法识别的合集编号。");
            var set = ParseDiscardedKeys(discardedKeys);
            set.Add(key);
            return NormalizeKeyList(set);
        }

        internal static string RemoveDiscardedKey(string discardedKeys, string key)
        {
            var set = ParseDiscardedKeys(discardedKeys);
            set.Remove((key ?? "").Trim());
            return NormalizeKeyList(set);
        }

        internal static HashSet<string> ParseDiscardedKeys(string discardedKeys)
        {
            var set = new HashSet<string>(StringComparer.Ordinal);
            foreach (var raw in (discardedKeys ?? "").Split('\n'))
            {
                var k = raw.Trim();
                if (k.Length == 0) continue;
                if (!AnimeCollectionPolicy.IsIdentifier(k)) continue;
                set.Add(k);
            }
            return set;
        }

        private static string NormalizeKeyList(IEnumerable<string> set) =>
            string.Join("\n", set.OrderBy(k => k, StringComparer.Ordinal));

    }
}