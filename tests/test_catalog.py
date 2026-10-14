import json
import struct
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from adapters.paperbin_catalog import Reader,parse_catalog
from asset_pipeline.runtime import Runtime
from asset_pipeline.ui_icons import export_icon


def integer(value):
    if value<128:return bytes([value])
    if value<16384:return bytes([128|(value>>8),value&255])
    if value<2097152:return bytes([192|(value>>16)])+value.to_bytes(3,'big')[1:]
    if value<268435456:return bytes([224|(value>>24)])+value.to_bytes(4,'big')[1:]
    return b'\xf0'+value.to_bytes(4,'big')


def string(value):
    encoded=value.encode();return integer(len(encoded))+encoded


class CatalogTests(unittest.TestCase):
    def test_compact_boundaries_and_truncation(self):
        for value in [0,127,128,257,16383,16384,2097151,2097152,268435455,1170000001]:
            r=Reader(integer(value));self.assertEqual(r.integer(),value);self.assertEqual(r.pos,len(r.data))
        for data in [b'\x80',b'\xf0\x00',b'\xf1']:
            with self.assertRaises(ValueError):Reader(data).integer()
        with self.assertRaises(ValueError):Reader(b'\x04abc').string()

    def test_name_icon_and_tag_hierarchy(self):
        ident=1170000001;key='ItemName_'+str(ident);tag='HomeNew.Furniture.Chair'
        data=string(key)+string('TbItem')+string('示例家具')
        data+=integer(ident)+string(key)+string('')+b''.join(integer(v) for v in [17,1700,1700,0,999999,4])
        data+=string("/Script/Engine.Texture2D'/Game/UI/Example/Icon.Icon'")+string('')
        data+=integer(257)+string('HOMENEW_FURNITURE_CHAIR')+string(tag)+integer(0)
        for category,tag_name,name in [(3000,'HomeNew.Furniture','普通家具'),(3004,tag,'座椅')]:
            text='NSLOCTEXT('+', '.join(json.dumps(v,ensure_ascii=False) for v in ['', 'DT_HomeObjectUIHierarchyType.'+tag_name+'.UIText',name])+')'
            data+=string(tag_name)+integer(category)+string(text)+string('/Game/UI/Example/Category')+string('')
        data+=integer(ident)+integer(1)+integer(257)+integer(0)
        items,categories,report=parse_catalog(data,[ident])
        self.assertEqual(items[str(ident)]['name'],'示例家具')
        self.assertEqual(items[str(ident)]['sourceIcon'],'/Game/UI/Example/Icon.Icon')
        self.assertEqual(items[str(ident)]['categoryId'],'3004')
        self.assertEqual(categories['3004']['parentId'],'3000')
        self.assertEqual(report['classified'],1)
        with self.assertRaises(ValueError):parse_catalog(b'changed-schema',[ident])

    def test_atlas_pixels_and_version_cache_isolation(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp);source='X6Game/Content/__ExternalPaper2dAtlas__/SaveAtlas/UI/Example/__Frames/Icon_PNG.uasset'
            atlas='X6Game/Content/Example/Atlas.uasset';original='X6Game/Content/UI/Example/Icon.uasset'
            def runtime(version,color):
                r=object.__new__(Runtime);r.version=version;r.directory=base/version;r.by_package={source:[{}],atlas:[{}]};r.ui_packages=set();r._ui_sources={}
                def export(packages,root,fmt):
                    for package in packages:
                        path=Path(root)/Path(package).with_suffix('.json' if fmt=='json' else '.png');path.parent.mkdir(parents=True,exist_ok=True)
                        if path.exists():continue
                        if fmt=='json':path.write_text(json.dumps([{'Type':'PaperSprite','Properties':{'BakedSourceTexture':{'ObjectPath':'/Game/Example/Atlas.0'},'BakedSourceUV':{'X':2,'Y':1},'BakedSourceDimension':{'X':3,'Y':2}}}]))
                        else:
                            with Image.new('RGBA',(8,8),color) as image:image.save(path)
                r.export=export;return r
            a=runtime('a'*64,(10,20,30,255));b=runtime('b'*64,(60,70,80,255))
            self.assertNotEqual(a.icon_url('/Game/UI/Example/Icon'),b.icon_url('/Game/UI/Example/Icon'))
            outputs=[]
            for r in [a,b]:
                root=r.directory/'ui-icons';target=root/Path(original).with_suffix('.png');export_icon(r,source,target,root);outputs.append(target.read_bytes())
                with Image.open(target) as icon:self.assertEqual(icon.size,(3,2));self.assertEqual(icon.getpixel((0,0)),(10,20,30,255) if r is a else (60,70,80,255))
            self.assertNotEqual(*outputs);self.assertTrue((a.directory/'ui-icons'/Path(original).with_suffix('.png')).exists())
            with self.assertRaises(ValueError):a.icon('../../outside.png')
            with self.assertRaises(ValueError):a.icon('X6Game/Content/UI/Unregistered.png')


if __name__=='__main__':unittest.main()
