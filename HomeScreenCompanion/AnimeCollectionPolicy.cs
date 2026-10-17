using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace HomeScreenCompanion
{
    public sealed class AnimeManagedCollection
    {
        public long CollectionId { get; set; }
        public int Anchor { get; set; }
        public string Name { get; set; } = "";
        public List<long> ManagedItemIds { get; set; } = new List<long>();
    }

    public sealed class AnimeCollectionState
    {
        public List<AnimeManagedCollection> Collections { get; set; } = new List<AnimeManagedCollection>();
    }

    internal sealed class AnimeDuplicate
    {
        public string Identifier { get; set; } = "";
        public List<long> EmbyIds { get; set; } = new List<long>();
    }

    // All configuration and membership decisions are resolved before entering the Emby writer.
    internal sealed class AnimeCollectionPolicy
    {
        private sealed class Rule
        {
            internal string Key = "";
            internal HashSet<string> Include = new HashSet<string>(StringComparer.Ordinal);
            internal HashSet<string> Exclude = new HashSet<string>(StringComparer.Ordinal);
        }

        private readonly List<Rule> _rules = new List<Rule>();
        private readonly HashSet<string> _approved = new HashSet<string>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> _aliases = new Dictionary<string, string>(StringComparer.Ordinal);

        internal static AnimeCollectionPolicy Parse(string rulesJson, string approvedKeys, string aliasesJson)
        {
            var policy = new AnimeCollectionPolicy();
            var keys = new HashSet<string>(StringComparer.Ordinal);
            if (!string.IsNullOrWhiteSpace(rulesJson))
            {
                var rules = JsonValueReader.Parse(rulesJson) as List<object>;
                if (rules == null) throw Invalid("成员规则必须为 JSON 数组。");
                foreach (var value in rules)
                {
                    var fields = value as Dictionary<string, object>;
                    if (fields == null || fields.Keys.Any(k => k != "Key" && k != "IncludeIds" && k != "ExcludeIds") ||
                        !fields.TryGetValue("Key", out var rawKey) || !(rawKey is string key) ||
                        !fields.TryGetValue("IncludeIds", out var include))
                        throw Invalid("规则必须包含 Key 和 IncludeIds，且不能有未知字段。");
                    ValidateKey(key);
                    if (!keys.Add(key)) throw Invalid("规则 Key 重复：" + key);
                    var rule = new Rule { Key = key, Include = ReadIds(include) };
                    if (fields.TryGetValue("ExcludeIds", out var exclude)) rule.Exclude = ReadIds(exclude);
                    policy._rules.Add(rule);
                }
            }
            foreach (var raw in (approvedKeys ?? "").Split('\n'))
            {
                var key = raw.Trim();
                if (key.Length == 0) continue;
                ValidateKey(key);
                if (!policy._approved.Add(key)) throw Invalid("批准列表 Key 重复：" + key);
            }
            if (!string.IsNullOrWhiteSpace(aliasesJson))
            {
                var aliases = JsonValueReader.Parse(aliasesJson) as Dictionary<string, object>;
                if (aliases == null) throw Invalid("合集别名必须为 JSON 对象。");
                foreach (var alias in aliases)
                {
                    ValidateKey(alias.Key);
                    if (!(alias.Value is string name) || string.IsNullOrWhiteSpace(name) || name.Any(char.IsControl))
                        throw Invalid("合集别名必须为非空文本：" + alias.Key);
                    policy._aliases[alias.Key] = name.Trim();
                }
            }
            return policy;
        }

        internal List<AnimeGroup> Apply(IEnumerable<AnimeGroup> automatic, IEnumerable<AnimeLocalItem> source)
        {
            var local = source.Where(i => i.EmbyId > 0).Select(i => new { Item = i, Ids = Identifiers(i) }).ToList();
            var automaticGroups = automatic.ToList();
            ValidateGroups(automaticGroups);
            var result = new List<AnimeGroup>();
            var claimed = new HashSet<long>();
            var mentioned = new HashSet<long>();
            var ruleKeys = new HashSet<string>(_rules.Select(r => r.Key), StringComparer.Ordinal);
            foreach (var rule in _rules)
            {
                var selected = new List<AnimeLocalItem>();
                foreach (var candidate in local)
                {
                    var item = candidate.Item;
                    bool included = candidate.Ids.Overlaps(rule.Include);
                    bool excluded = candidate.Ids.Overlaps(rule.Exclude);
                    if (included || excluded) mentioned.Add(item.EmbyId);
                    if (!included || excluded) continue;
                    if (!claimed.Add(item.EmbyId)) throw Invalid("同一媒体被多个规则选择：" + item.EmbyId);
                    selected.Add(item);
                }
                // Keep singleton/empty explicit selections visible for review, but never write them.
                result.Add(new AnimeGroup
                {
                    Anchor = ParseAnchor(rule.Key), Key = rule.Key,
                    Name = AnimeGroupPlanner.ChooseName(selected),
                    EmbyIds = selected.Select(i => i.EmbyId).Distinct().OrderBy(id => id).ToList(),
                    HasExplicitRule = true
                });
            }
            foreach (var group in automaticGroups)
            {
                // An exact rule replaces the claimed automatic component, not just its selected members.
                if (ruleKeys.Contains(group.Key) || group.EmbyIds.Any(mentioned.Contains)) continue;
                result.Add(new AnimeGroup
                {
                    Anchor = group.Anchor, Key = group.Key, Name = group.Name,
                    EmbyIds = group.EmbyIds.ToList(), ReviewRequired = group.ReviewRequired
                });
            }
            ValidateGroups(result);
            foreach (var group in result)
                if (_aliases.TryGetValue(group.Key, out var alias)) group.Name = alias;
            return result.OrderBy(g => g.Anchor).ToList();
        }

        internal bool CanWrite(AnimeGroup group, bool dryRun) =>
            !dryRun && group.EmbyIds.Count >= 2 && _approved.Contains(group.Key) &&
            (!group.ReviewRequired || group.HasExplicitRule);

        internal static bool CanUseIdentity(long? ownedCollectionId, long? existingCollectionId,
            IEnumerable<long> nameMatches)
        {
            if (!ownedCollectionId.HasValue)
                return !existingCollectionId.HasValue && !nameMatches.Any();
            return ownedCollectionId.Value > 0 && existingCollectionId == ownedCollectionId &&
                nameMatches.All(id => id == ownedCollectionId.Value);
        }

        internal static HashSet<long> FindSplitCollectionIds(IEnumerable<AnimeGroup> allGroups,
            IEnumerable<AnimeManagedCollection> owned)
        {
            var groups = allGroups.ToList();
            return new HashSet<long>(owned.Where(prior =>
                groups.Count(g => g.Anchor == prior.Anchor || g.EmbyIds.Any(prior.ManagedItemIds.Contains)) > 1)
                .Select(prior => prior.CollectionId));
        }

        internal static long[] PlanRemovals(AnimeGroup group, IEnumerable<long> previousOwned,
            IEnumerable<long> currentMembers, IEnumerable<long> approvedReassignments)
        {
            var desired = new HashSet<long>(group.EmbyIds);
            var current = currentMembers as HashSet<long> ?? new HashSet<long>(currentMembers);
            var reassigned = group.HasExplicitRule ? null :
                approvedReassignments as HashSet<long> ?? new HashSet<long>(approvedReassignments);
            return previousOwned.Where(id => !desired.Contains(id) && current.Contains(id) &&
                (group.HasExplicitRule || reassigned!.Contains(id))).Distinct().OrderBy(id => id).ToArray();
        }

        internal static List<AnimeDuplicate> FindDuplicates(IEnumerable<AnimeLocalItem> source) =>
            source.Where(i => i.EmbyId > 0).SelectMany(i => Identifiers(i).Where(id => !id.StartsWith("anilist:", StringComparison.Ordinal)).Select(id => new { Id = id, i.EmbyId }))
                .GroupBy(x => x.Id, StringComparer.Ordinal)
                .Select(g => new AnimeDuplicate { Identifier = g.Key, EmbyIds = g.Select(x => x.EmbyId).Distinct().OrderBy(id => id).ToList() })
                .Where(g => g.EmbyIds.Count > 1).OrderBy(g => g.Identifier, StringComparer.Ordinal).ToList();

        private static HashSet<string> Identifiers(AnimeLocalItem item)
        {
            var result = new HashSet<string>(StringComparer.Ordinal);
            foreach (var raw in item.ProviderIds)
            {
                var id = (raw ?? "").Trim().ToLowerInvariant();
                if (IsIdentifier(id)) result.Add(id);
            }
            foreach (var id in item.AniListIds.Where(id => id > 0)) result.Add("anilist:" + id.ToString(CultureInfo.InvariantCulture));
            return result;
        }

        private static void ValidateGroups(List<AnimeGroup> groups)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            var members = new HashSet<long>();
            foreach (var group in groups)
            {
                ValidateKey(group.Key);
                if (ParseAnchor(group.Key) != group.Anchor || !keys.Add(group.Key)) throw Invalid("合集稳定 Key 重复或与 Anchor 不一致：" + group.Key);
                foreach (var id in group.EmbyIds)
                    if (id <= 0 || !members.Add(id)) throw Invalid("合集成员重叠或无效：" + id);
            }
        }

        private static HashSet<string> ReadIds(object value)
        {
            var array = value as List<object>;
            if (array == null) throw Invalid("IncludeIds/ExcludeIds 必须为标识符数组。");
            var result = new HashSet<string>(StringComparer.Ordinal);
            foreach (var entry in array)
            {
                if (!(entry is string id) || !IsIdentifier(id)) throw Invalid("媒体标识符无效。");
                if (!result.Add(id)) throw Invalid("媒体标识符重复：" + id);
            }
            return result;
        }

        internal static bool IsIdentifier(string id)
        {
            if (string.IsNullOrEmpty(id)) return false;
            int colon = id.IndexOf(':');
            if (colon < 1) return false;
            var type = id.Substring(0, colon);
            var value = id.Substring(colon + 1);
            switch (type)
            {
                case "anilist": return int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var anchor) && anchor > 0 && value == anchor.ToString(CultureInfo.InvariantCulture);
                case "tmdb_movie": case "tmdb_show": case "tvdb_movie": case "tvdb_show": break;
                case "imdb_movie": case "imdb_show":
                    if (!value.StartsWith("tt", StringComparison.Ordinal)) return false;
                    value = value.Substring(2);
                    return value.Length > 0 && value.All(c => c >= '0' && c <= '9') && value.Any(c => c != '0');
                default: return false;
            }
            return value.Length > 0 && value[0] != '0' && value.All(c => c >= '0' && c <= '9');
        }

        private static void ValidateKey(string key)
        {
            if (key == null || !key.StartsWith("anilist:", StringComparison.Ordinal) || !IsIdentifier(key))
                throw Invalid("稳定 Key 必须为 anilist:<正整数>，不允许前导零。");
        }
        private static int ParseAnchor(string key) => int.Parse(key.Substring(8), CultureInfo.InvariantCulture);
        private static InvalidDataException Invalid(string message) => new InvalidDataException(message);

        // The configuration grammar only admits objects, arrays and strings. Reject primitives,
        // duplicate fields and trailing commas/content instead of relying on serializer coercion.
        private sealed class JsonValueReader
        {
            private readonly string _text;
            private int _position;
            private JsonValueReader(string text) { _text = text; }
            internal static object Parse(string text)
            {
                var reader = new JsonValueReader(text);
                var result = reader.Value();
                reader.Peek();
                if (reader._position != text.Length) throw Invalid("JSON 末尾存在多余内容。");
                return result;
            }
            private char Peek()
            {
                while (_position < _text.Length && (_text[_position] == ' ' || _text[_position] == '\r' || _text[_position] == '\n' || _text[_position] == '\t')) _position++;
                return _position < _text.Length ? _text[_position] : '\0';
            }
            private void Expect(char c)
            {
                if (Peek() != c) throw Invalid("JSON 格式无效，预期字符：" + c);
                _position++;
            }
            private object Value()
            {
                switch (Peek())
                {
                    case '"': return Text();
                    case '[':
                        _position++;
                        var array = new List<object>();
                        if (Peek() == ']') { _position++; return array; }
                        do { array.Add(Value()); if (Peek() != ',') break; _position++; } while (true);
                        Expect(']'); return array;
                    case '{':
                        _position++;
                        var fields = new Dictionary<string, object>(StringComparer.Ordinal);
                        if (Peek() == '}') { _position++; return fields; }
                        do
                        {
                            var key = Text(); Expect(':');
                            if (fields.ContainsKey(key)) throw Invalid("JSON 字段重复：" + key);
                            fields.Add(key, Value());
                            if (Peek() != ',') break;
                            _position++;
                        } while (true);
                        Expect('}'); return fields;
                    default: throw Invalid("JSON 值必须为对象、数组或字符串。");
                }
            }
            private string Text()
            {
                Expect('"');
                var text = new StringBuilder();
                while (_position < _text.Length)
                {
                    char c = _text[_position++];
                    if (c == '"') return text.ToString();
                    if (c < 0x20) throw Invalid("JSON 字符串包含控制字符。");
                    if (c == '\\')
                    {
                        if (_position >= _text.Length) throw Invalid("JSON 转义不完整。");
                        c = _text[_position++];
                        switch (c)
                        {
                            case '"': case '\\': case '/': break;
                            case 'b': c = '\b'; break;
                            case 'f': c = '\f'; break;
                            case 'n': c = '\n'; break;
                            case 'r': c = '\r'; break;
                            case 't': c = '\t'; break;
                            case 'u':
                                if (_position + 4 > _text.Length || !ushort.TryParse(_text.Substring(_position, 4), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var code)) throw Invalid("JSON Unicode 转义无效。");
                                _position += 4; c = (char)code; break;
                            default: throw Invalid("JSON 转义无效。");
                        }
                    }
                    text.Append(c);
                }
                throw Invalid("JSON 字符串不完整。");
            }
        }
    }
}
