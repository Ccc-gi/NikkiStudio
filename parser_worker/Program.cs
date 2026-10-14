// Persistent local stdio worker. Credentials stay off process command lines.
using System.Collections.Concurrent;
using System.Diagnostics;
using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Options;
using CUE4Parse_Conversion.Textures.BC;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Serilog;

var protocol = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
Console.SetOut(Console.Error);
Log.Logger = new LoggerConfiguration().MinimumLevel.Fatal().CreateLogger();
DefaultFileProvider? provider = null;
while (Console.ReadLine() is { } line)
{
    var watch = Stopwatch.StartNew();
    JObject? request = null;
    try
    {
        request = JObject.Parse(line);
        var op = (string?)request["op"];
        if (op == "init")
        {
            provider?.Dispose();
            var oodle = Path.Combine(Path.GetTempPath(), OodleHelper.OodleFileName);
            OodleHelper.DownloadOodleDll(ref oodle); OodleHelper.Initialize(oodle);
            var zlib = Path.Combine(Path.GetTempPath(), ZlibHelper.DLL_NAME);
            ZlibHelper.DownloadDll(zlib); ZlibHelper.Initialize(zlib);
            var detex = Path.Combine(Path.GetTempPath(), DetexHelper.DLL_NAME);
            DetexHelper.LoadDll(detex); DetexHelper.Initialize(detex);
            provider = new DefaultFileProvider((string)request["gameRoot"]!, SearchOption.AllDirectories,
                new VersionContainer(EGame.GAME_InfinityNikki));
            provider.MappingsContainer = new FileUsmapTypeMappingsProvider((string)request["usmapFile"]!);
            provider.Initialize();
            var keys = JObject.Parse(File.ReadAllText((string)request["keysFile"]!));
            var keyMap = new Dictionary<FGuid, FAesKey> { [new FGuid()] = new FAesKey((string)(keys["mainKey"] ?? keys["MainKey"])!) };
            foreach (var row in (JArray)(keys["dynamicKeys"] ?? keys["DynamicKeys"] ?? new JArray()))
                keyMap[new FGuid(((string)(row["guid"] ?? row["Guid"])!).Replace("-", ""))] =
                    new FAesKey((string)(row["key"] ?? row["Key"])!);
            provider.SubmitKeys(keyMap);
            provider.PostMount();
            protocol.WriteLine(JsonConvert.SerializeObject(new { ok = true, files = provider.Files.Count, seconds = watch.Elapsed.TotalSeconds }));
            continue;
        }
        if (op == "close") break;
        if (provider is null || op != "export") throw new InvalidOperationException();
        var paths = request["packages"]!.ToObject<string[]>()!;
        if (paths.Length == 0) throw new ArgumentException();
        var output = (string)request["output"]!;
        var format = (string)request["format"]!;
        Directory.CreateDirectory(output);
        var errors = new ConcurrentBag<string>();
        var objects = new ConcurrentBag<UObject>();
        Parallel.ForEach(paths, new ParallelOptions { MaxDegreeOfParallelism = 8 }, path =>
        {
            try
            {
                var exports = provider.LoadPackage(path).GetExports().ToArray();
                if (format == "json")
                {
                    var file = Path.Combine(output, Path.ChangeExtension(path, ".json"));
                    Directory.CreateDirectory(Path.GetDirectoryName(file)!);
                    File.WriteAllText(file, JsonConvert.SerializeObject(exports));
                }
                else
                    foreach (var obj in exports)
                        if (format is "png" or "ktx2" ? obj is UTexture : obj is UStaticMesh or USkeletalMesh)
                            objects.Add(obj);
            }
            catch { errors.Add(path); }
        });
        if (!objects.IsEmpty)
        {
            var session = new ExportSession { MaxDegreeOfParallelism = 8 };
            Parallel.ForEach(objects, new ParallelOptions { MaxDegreeOfParallelism = 12 }, obj =>
            {
                try
                {
                    if (format == "ktx2" && obj is UTexture texture && GpuTexture.Write(texture, output)) return;
                    session.Add(obj);
                }
                catch { errors.Add(obj.GetPathName()); }
            });
            var options = new ExportOptions(meshFormat: EMeshFormat.Gltf2,
                naniteMeshFormat: ENaniteMeshFormat.NaniteFirst, exportMaterials: false);
            var results = await session.RunAsync(output, options);
            foreach (var result in results) if (!result.Success) errors.Add(result.ObjectPath);
        }
        protocol.WriteLine(JsonConvert.SerializeObject(new { ok = true, errors = errors.ToArray(), seconds = watch.Elapsed.TotalSeconds }));
    }
    catch (Exception error)
    {
        // Exception messages from third party parsing can contain credentials.
        protocol.WriteLine(JsonConvert.SerializeObject(new { ok = false, error = error.GetType().Name, seconds = watch.Elapsed.TotalSeconds }));
    }
}
provider?.Dispose();
