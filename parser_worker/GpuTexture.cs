using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion.Textures;

internal static class GpuTexture
{
    // KTX2 wraps original desktop BC blocks without recompression or resolution loss.
    public static bool Write(UTexture texture, string output)
    {
        var spec = texture.Format.ToString() switch
        {
            "PF_DXT1" => (vk: 133u, bytes: 8, model: 128),
            "PF_DXT5" => (vk: 137u, bytes: 16, model: 130),
            "PF_BC4" => (vk: 139u, bytes: 8, model: 131),
            "PF_BC5" => (vk: 141u, bytes: 16, model: 132),
            "PF_BC7" => (vk: 145u, bytes: 16, model: 134),
            _ => (vk: 0u, bytes: 0, model: 0)
        };
        if (spec.vk == 0 || texture.PlatformData.VTData is { } vt && vt.IsInitialized()) return false;
        if (texture is UTextureCube or UVolumeTexture) return false;
        var first = texture.GetFirstMipIndex();
        var mip = texture.GetMip(first);
        if (mip?.BulkData?.Data is not { Length: > 0 } raw) return false;
        var size = ((mip.SizeX + 3) / 4) * ((mip.SizeY + 3) / 4) * spec.bytes;
        int layers = texture is UTexture2DArray ? Math.Max(mip.SizeZ, 1) : 1;
        if (raw.Length != size * layers) return false;
        var levels = new List<(byte[] raw, int size)> { (raw, size) };
        for (var index = first + 1; index < texture.PlatformData.Mips.Length; index++)
        {
            var next = texture.GetMip(index);
            var width = Math.Max(1, mip.SizeX >> levels.Count);
            var height = Math.Max(1, mip.SizeY >> levels.Count);
            if (next == null || next.SizeX != width || next.SizeY != height ||
                next.BulkData?.Data is not { Length: > 0 } bytes) break;
            var levelSize = ((width + 3) / 4) * ((height + 3) / 4) * spec.bytes;
            if (bytes.Length != levelSize * layers) break;
            levels.Add((bytes, levelSize));
        }
        var dfdOffset = 80 + levels.Count * 24;
        ulong Align(ulong value) => (value + (ulong)spec.bytes - 1) / (ulong)spec.bytes * (ulong)spec.bytes;
        var offsets = new ulong[levels.Count];
        var end = Align((ulong)(dfdOffset + 44));
        for (var index = levels.Count - 1; index >= 0; index--)
        {
            offsets[index] = end;
            end = Align(end + (ulong)levels[index].size);
        }
        var objectPath = texture.GetPathName();
        var package = objectPath.Split('.')[0].Replace("/Game/", "X6Game/Content/");
        for (var layer = 0; layer < layers; layer++)
        {
            var suffix = texture is UTexture2DArray ? $"_LAYER{layer}" : "";
            var path = Path.Combine(output, package + suffix + ".ktx2");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temporary = path + ".partial";
            using var file = File.Create(temporary);
            using var writer = new BinaryWriter(file);
            writer.Write(new byte[] {0xAB,0x4B,0x54,0x58,0x20,0x32,0x30,0xBB,0x0D,0x0A,0x1A,0x0A});
            writer.Write(spec.vk); writer.Write(1u);
            writer.Write((uint)mip.SizeX); writer.Write((uint)mip.SizeY);
            writer.Write(0u); writer.Write(0u); writer.Write(1u); writer.Write((uint)levels.Count); writer.Write(0u);
            writer.Write((uint)dfdOffset); writer.Write(44u); writer.Write(0u); writer.Write(0u);
            writer.Write(0ul); writer.Write(0ul);
            for (var index = 0; index < levels.Count; index++)
            {
                writer.Write(offsets[index]); writer.Write((ulong)levels[index].size); writer.Write((ulong)levels[index].size);
            }
            writer.Write(44u); writer.Write(0u); writer.Write((ushort)2); writer.Write((ushort)40);
            writer.Write((byte)spec.model); writer.Write((byte)1); writer.Write((byte)1); writer.Write((byte)0);
            writer.Write(new byte[]{3,3,0,0}); writer.Write((byte)spec.bytes); writer.Write(new byte[7]);
            writer.Write((ushort)0); writer.Write((byte)(spec.bytes * 8 - 1)); writer.Write((byte)0);
            writer.Write(0u); writer.Write(0u); writer.Write(uint.MaxValue);
            for (var index = levels.Count - 1; index >= 0; index--)
            {
                writer.Write(new byte[checked((int)(offsets[index] - (ulong)file.Position))]);
                writer.Write(levels[index].raw, layer * levels[index].size, levels[index].size);
            }
            writer.Dispose(); file.Dispose(); File.Move(temporary, path, true);
        }
        return true;
    }
}
