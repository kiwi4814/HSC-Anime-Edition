using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace HomeScreenCompanion
{
    /// <summary>
    /// Streaming reader for the published AniBridge Mappings v3 JSON payload.
    /// Only descriptor-to-descriptor identity links are needed here; episode-range bodies
    /// are skipped. This deliberately does not infer reverse *episode* mappings.
    /// </summary>
    internal sealed class AnimeMappingIndex
    {
        private readonly Dictionary<string, HashSet<int>> _byProvider =
            new Dictionary<string, HashSet<int>>(StringComparer.OrdinalIgnoreCase);

        public int IdentityLinks { get; private set; }
        public int SourceDescriptors { get; private set; }

        public IReadOnlyCollection<int> Match(string provider, string id)
        {
            if (string.IsNullOrWhiteSpace(provider) || string.IsNullOrWhiteSpace(id))
                return Array.Empty<int>();
            return _byProvider.TryGetValue(provider.ToLowerInvariant() + ":" + id.Trim(), out var result)
                ? result.ToArray() : (IReadOnlyCollection<int>)Array.Empty<int>();
        }

        public static AnimeMappingIndex Load(string path)
        {
            using (var reader = new StreamReader(path, Encoding.UTF8, true))
                return Parse(reader);
        }

        internal static AnimeMappingIndex Parse(TextReader input)
        {
            var json = new DescriptorJsonReader(input);
            var index = new AnimeMappingIndex();
            json.BeginObject();
            bool firstSource = true;
            while (json.NextProperty(ref firstSource, out var source))
            {
                if (!IsMediaDescriptor(source))
                {
                    json.SkipValue();
                    continue;
                }
                index.SourceDescriptors++;
                json.BeginObject();
                bool firstTarget = true;
                while (json.NextProperty(ref firstTarget, out var target))
                {
                    if (TryAniList(source, out var sourceAnime) && IsLibraryDescriptor(target))
                        index.Add(target, sourceAnime);
                    else if (TryAniList(target, out var targetAnime) && IsLibraryDescriptor(source))
                        index.Add(source, targetAnime);
                    json.SkipValue(); // episode ranges are intentionally not interpreted
                }
            }
            json.EnsureFinished();
            if (index.SourceDescriptors < 1 || index.IdentityLinks < 1)
                throw new InvalidDataException("AniBridge 映射文件中没有可用的作品身份关联。");
            return index;
        }

        private void Add(string descriptor, int animeId)
        {
            var parts = descriptor.Split(':');
            if (parts.Length < 2) return;
            // Season-specific scopes are folded into the series ID; one Emby Series represents
            // the complete show across seasons and is linked to every mapped anime entry.
            var key = parts[0].ToLowerInvariant() + ":" + parts[1];
            if (!_byProvider.TryGetValue(key, out var ids))
            {
                ids = new HashSet<int>();
                _byProvider.Add(key, ids);
            }
            if (ids.Add(animeId)) IdentityLinks++;
        }

        private static bool TryAniList(string descriptor, out int id)
        {
            id = 0;
            var parts = descriptor.Split(':');
            return parts.Length == 2 && parts[0] == "anilist" &&
                   int.TryParse(parts[1], out id) && id > 0;
        }

        private static bool IsMediaDescriptor(string value) =>
            value.StartsWith("anilist:", StringComparison.Ordinal) || IsLibraryDescriptor(value);

        private static bool IsLibraryDescriptor(string value) =>
            value.StartsWith("tmdb_show:", StringComparison.Ordinal) ||
            value.StartsWith("tmdb_movie:", StringComparison.Ordinal) ||
            value.StartsWith("tvdb_show:", StringComparison.Ordinal) ||
            value.StartsWith("tvdb_movie:", StringComparison.Ordinal) ||
            value.StartsWith("imdb_show:", StringComparison.Ordinal) ||
            value.StartsWith("imdb_movie:", StringComparison.Ordinal);
    }

    /// <summary>
    /// Small JSON token reader with bounded memory. It only exposes properties and value
    /// skipping; it is NOT intended as a general JSON serializer.
    /// </summary>
    internal sealed class DescriptorJsonReader
    {
        private readonly TextReader _reader;
        private const int MaxStringLength = 8192;
        public DescriptorJsonReader(TextReader reader) { _reader = reader; }

        public void BeginObject() => Expect('{');

        public bool NextProperty(ref bool first, out string property)
        {
            property = "";
            int next = Peek();
            if (next == '}') { _reader.Read(); return false; }
            if (!first) Expect(',');
            else first = false;
            property = ReadString();
            Expect(':');
            return true;
        }

        public void SkipValue()
        {
            int next = Peek();
            if (next == '{')
            {
                BeginObject();
                bool first = true;
                while (NextProperty(ref first, out _)) SkipValue();
            }
            else if (next == '[')
            {
                Expect('[');
                bool first = true;
                while (true)
                {
                    next = Peek();
                    if (next == ']') { _reader.Read(); break; }
                    if (!first) Expect(',');
                    else first = false;
                    SkipValue();
                }
            }
            else if (next == '"') { ReadString(); }
            else
            {
                // Primitive: number, true, false, null. Terminate before a structural token.
                var token = new StringBuilder();
                while (true)
                {
                    next = _reader.Peek();
                    if (next < 0 || next == ',' || next == '}' || next == ']' || char.IsWhiteSpace((char)next)) break;
                    if (token.Length > 100) throw new InvalidDataException("JSON 基本值无效。");
                    token.Append((char)_reader.Read());
                }
                var value = token.ToString();
                if (value != "true" && value != "false" && value != "null" &&
                    !double.TryParse(value, System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture, out _))
                    throw new InvalidDataException("JSON 基本值无效。");
            }
        }

        public void EnsureFinished()
        {
            while (_reader.Peek() >= 0)
                if (!char.IsWhiteSpace((char)_reader.Read()))
                    throw new InvalidDataException("JSON 末尾包含多余内容。");
        }

        private string ReadString()
        {
            Expect('"');
            var value = new StringBuilder();
            while (true)
            {
                int code = _reader.Read();
                if (code < 0) throw new EndOfStreamException("JSON 字符串不完整。");
                if (code == '"') return value.ToString();
                if (code == '\\')
                {
                    code = _reader.Read();
                    switch (code)
                    {
                        case '"': case '\\': case '/': break;
                        case 'b': code = '\b'; break;
                        case 'f': code = '\f'; break;
                        case 'n': code = '\n'; break;
                        case 'r': code = '\r'; break;
                        case 't': code = '\t'; break;
                        case 'u':
                            var hex = new char[4];
                            for (int i = 0; i < 4; i++)
                            {
                                int d = _reader.Read();
                                if (d < 0) throw new EndOfStreamException("JSON 转义序列不完整。");
                                hex[i] = (char)d;
                            }
                            if (!int.TryParse(new string(hex), System.Globalization.NumberStyles.HexNumber,
                                    System.Globalization.CultureInfo.InvariantCulture, out code))
                                throw new InvalidDataException("JSON Unicode 转义序列无效。");
                            break;
                        default: throw new InvalidDataException("JSON 转义序列无效。");
                    }
                }
                else if (code < 0x20) throw new InvalidDataException("JSON 中包含无效的控制字符。");
                if (value.Length >= MaxStringLength) throw new InvalidDataException("JSON 字符串过长。");
                value.Append((char)code);
            }
        }

        private int Peek()
        {
            int value;
            while ((value = _reader.Peek()) >= 0 && char.IsWhiteSpace((char)value)) _reader.Read();
            if (value < 0) throw new EndOfStreamException("JSON 数据不完整。");
            return value;
        }

        private void Expect(char expected)
        {
            if (Peek() != expected) throw new InvalidDataException("JSON 格式错误；预期字符：" + expected);
            _reader.Read();
        }
    }
}
