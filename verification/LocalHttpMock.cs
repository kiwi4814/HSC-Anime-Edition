using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Channels;

// A real loopback TCP/HTTP server. It returns controlled provider responses, never echoes prompts.
internal sealed class LocalHttpMock : IAsyncDisposable
{
    internal sealed record Request(string Method, string Path, IReadOnlyDictionary<string, string> Headers, string Body);
    internal sealed record Reply(int Status, string Body, string? Location = null, TimeSpan Delay = default);
    private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource _stop = new();
    private readonly Channel<Request> _received = Channel.CreateUnbounded<Request>();
    private readonly Func<Request, Reply> _respond;
    private readonly List<Task> _connections = new();
    private readonly Task _accept;
    internal string Url { get; }
    internal int RequestCount;

    internal LocalHttpMock(Func<Request, Reply> respond)
    {
        _respond = respond;
        _listener.Start();
        Url = "http://127.0.0.1:" + ((IPEndPoint)_listener.LocalEndpoint).Port;
        _accept = AcceptAsync();
    }

    internal async Task<Request> NextAsync()
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        return await _received.Reader.ReadAsync(deadline.Token);
    }

    private async Task AcceptAsync()
    {
        try
        {
            while (!_stop.IsCancellationRequested)
            {
                var connection = await _listener.AcceptTcpClientAsync(_stop.Token);
                _connections.Add(ServeAsync(connection));
            }
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested) { }
        catch (SocketException) when (_stop.IsCancellationRequested) { }
    }

    private async Task ServeAsync(TcpClient connection)
    {
        using (connection)
        {
            try
            {
                var stream = connection.GetStream();
                var header = new List<byte>(); var single = new byte[1];
                while (header.Count < 65536)
                {
                    if (await stream.ReadAsync(single.AsMemory(), _stop.Token) == 0) return;
                    header.Add(single[0]);
                    int n = header.Count;
                    if (n >= 4 && header[n - 4] == 13 && header[n - 3] == 10 && header[n - 2] == 13 && header[n - 1] == 10) break;
                }
                var lines = Encoding.ASCII.GetString(header.ToArray()).Split("\r\n");
                var first = lines[0].Split(' ');
                var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var line in lines.Skip(1))
                {
                    var colon = line.IndexOf(':');
                    if (colon > 0) headers[line[..colon]] = line[(colon + 1)..].Trim();
                }
                int length = headers.TryGetValue("Content-Length", out var raw) ? int.Parse(raw) : 0;
                if (length < 0 || length > 1024 * 1024) throw new InvalidDataException("Unexpected local test request size");
                var body = new byte[length]; int offset = 0;
                while (offset < body.Length)
                {
                    int count = await stream.ReadAsync(body.AsMemory(offset), _stop.Token);
                    if (count == 0) throw new EndOfStreamException();
                    offset += count;
                }
                var request = new Request(first[0], first[1], headers, Encoding.UTF8.GetString(body));
                Interlocked.Increment(ref RequestCount);
                await _received.Writer.WriteAsync(request, _stop.Token);
                var reply = _respond(request);
                if (reply.Delay > TimeSpan.Zero) await Task.Delay(reply.Delay, _stop.Token);
                var payload = Encoding.UTF8.GetBytes(reply.Body);
                var responseHeader = Encoding.ASCII.GetBytes($"HTTP/1.1 {reply.Status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {payload.Length}\r\nConnection: close\r\n" + (reply.Location == null ? "" : "Location: " + reply.Location + "\r\n") + "\r\n");
                await stream.WriteAsync(responseHeader.AsMemory(), _stop.Token);
                await stream.WriteAsync(payload.AsMemory(), _stop.Token);
            }
            catch (OperationCanceledException) when (_stop.IsCancellationRequested) { }
            catch (IOException) { /* A timeout/cancel test intentionally closes the socket. */ }
            catch (SocketException) { /* A timeout/cancel test intentionally closes the socket. */ }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _stop.Cancel(); _listener.Stop();
        await _accept;
        await Task.WhenAll(_connections);
        _stop.Dispose();
    }
}
