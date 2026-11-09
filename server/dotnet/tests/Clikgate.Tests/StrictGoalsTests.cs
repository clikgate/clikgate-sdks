using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Clikgate.Tests;

/// <summary>
/// "Allow unknown goal names" off: 422 unknown_goal and goal_archived are final (never retried), the SDK never
/// remembers a refusal, and a debug-level line names the goal only.
/// </summary>
public class StrictGoalsTests
{
    private const string Key = "cg_test_unit000000000000";
    private const string Line = "Goal `level_complete` isn't set up in Clikgate";
    private const string Envelope = "{\"error\":{\"type\":\"invalid_request\",\"code\":\"unknown_goal\",\"message\":\"Not set up.\",\"param\":\"goal\"},\"status\":\"refused\",\"reason\":\"unknown_goal\",\"counted\":false,\"goal_kind\":null}";
    private const string Refusal = "{\"status\":\"refused\",\"reason\":\"unknown_goal\",\"counted\":false,\"goal_kind\":null}";
    private const string Batch = "{\"object\":\"list\",\"data\":[{\"index\":0,\"ok\":true,\"status\":201,\"goal_event\":{\"object\":\"goal_event\",\"status\":\"counted\",\"reason\":null},\"error\":null},"
        + "{\"index\":1,\"ok\":false,\"status\":422,\"goal_event\":null,\"error\":{\"type\":\"invalid_request\",\"code\":\"unknown_goal\",\"message\":\"x\",\"param\":\"goal\"}}]}";

    /// <summary>Answers from a script (the last answer repeats).</summary>
    private sealed class Script(params (int Status, string Body)[] answers) : HttpMessageHandler
    {
        private readonly Queue<(int Status, string Body)> _answers = new(answers);

        public int Calls;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Calls);
            (int Status, string Body) a;
            lock (_answers)
            {
                a = _answers.Count > 1 ? _answers.Dequeue() : _answers.Peek();
            }
            return Task.FromResult(new HttpResponseMessage((HttpStatusCode)a.Status) { Content = new StringContent(a.Body, Encoding.UTF8, "application/json") });
        }
    }

    private sealed class Lines : IClikgateLogger
    {
        public ConcurrentQueue<(ClikgateLogLevel Level, string Message)> All { get; } = new();

        public void Log(ClikgateLogLevel level, string code, string message) => All.Enqueue((level, message));

        public List<string> Debug() => All.Where(l => l.Level == ClikgateLogLevel.Debug).Select(l => l.Message).ToList();
    }

    private static ClikgateClient Client(Script s, Lines log, SendMode mode = SendMode.Sync, List<string>? errors = null) => new(new ClikgateOptions
    {
        ApiKey = Key,
        HttpClient = new HttpClient(s),
        PrivateMode = PrivateMode.Off,
        SendMode = mode,
        ShutdownHooks = false,
        MaxRetries = 3,
        Logger = log,
        OnError = errors is null ? null : (e, ctx) =>
        {
            lock (errors)
            {
                errors.Add(e.Code + " " + ctx.Dropped);
            }
        },
    });

    [Fact]
    public async Task Unknown_goal_is_final_and_logged_at_debug_with_the_name_only()
    {
        var s = new Script((422, Envelope));
        var log = new Lines();
        var c = Client(s, log);
        var e = await Assert.ThrowsAsync<InvalidRequestException>(() => c.Goals.SendAsync("level_complete", new GoalOptions { Reference = "APP-77120", Value = "2500", Label = "Ada" }));
        Assert.Equal("unknown_goal", e.Code);
        Assert.Equal(422, e.HttpStatus);
        Assert.Equal(1, s.Calls);
        Assert.Equal(new[] { Line }, log.Debug());
        Assert.DoesNotContain(log.All, l => l.Message.Contains("APP-77120") || l.Message.Contains("2500") || l.Message.Contains("Ada"));
    }

    [Fact]
    public async Task Refusal_body_maps_to_its_reason()
    {
        var s = new Script((422, Refusal), (422, "{\"status\":\"refused\",\"reason\":\"goal_archived\"}"));
        var log = new Lines();
        var c = Client(s, log);
        var unknown = await Assert.ThrowsAsync<InvalidRequestException>(() => c.Goals.SendAsync("level_complete", new GoalOptions { Reference = "APP-1" }));
        Assert.Equal("unknown_goal", unknown.Code);
        Assert.NotNull(unknown.Raw);
        Assert.Null(unknown.Param);
        var archived = await Assert.ThrowsAsync<InvalidRequestException>(() => c.Goals.SendAsync("old_signup", new GoalOptions { Reference = "APP-2" }));
        Assert.Equal("goal_archived", archived.Code);
        Assert.Equal(422, archived.HttpStatus);
        Assert.Equal(2, s.Calls);
        Assert.Equal(new[] { Line }, log.Debug());
    }

    [Fact]
    public async Task The_name_is_never_remembered()
    {
        var s = new Script((422, Envelope), (201, "{\"object\":\"goal_event\",\"status\":\"counted\"}"));
        var c = Client(s, new Lines());
        await Assert.ThrowsAsync<InvalidRequestException>(() => c.Goals.SendAsync("level_complete", new GoalOptions { Reference = "APP-1" }));
        var ev = await c.Goals.SendAsync("level_complete", new GoalOptions { Reference = "APP-2" });
        Assert.Equal(GoalStatus.COUNTED, ev.Status);
        Assert.Equal(2, s.Calls);
    }

    [Fact]
    public async Task Batch_and_background_items()
    {
        var s = new Script((200, Batch));
        var log = new Lines();
        var r = await Client(s, log).Goals.SendBatchAsync([new GoalBatchEvent { Goal = "order_paid", Reference = "R-0" }, new GoalBatchEvent { Goal = "level_complete", Reference = "APP-77120" }]);
        Assert.False(r.Data[1].Ok);
        var errors = new List<string>();
        var bg = Client(s, log, SendMode.Background, errors);
        bg.Goal("order_paid", new GoalOptions { Reference = "R-0" });
        bg.Goal("level_complete", new GoalOptions { Reference = "APP-77120", Value = "2500" });
        Assert.True(await bg.FlushAsync(TimeSpan.FromSeconds(2)));
        Assert.True(await bg.FlushAsync(TimeSpan.FromSeconds(2)));
        await bg.CloseAsync(TimeSpan.FromSeconds(1));
        Assert.Equal(2, s.Calls);
        Assert.Equal(new[] { "unknown_goal True" }, errors);
        Assert.Equal(new[] { Line, Line }, log.Debug());
    }
}
