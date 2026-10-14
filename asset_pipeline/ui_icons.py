"""Current-game texture icons and explicitly referenced PaperSprite atlas regions."""
from collections import OrderedDict
from pathlib import Path
import math
from PIL import Image


def export_icon(runtime,source,target,root):
    from asset_pipeline.runtime import package_path
    if '/__Frames/' not in source:
        runtime.export([source],root,'png')
        return
    props=root/'properties'
    runtime.export([source],props,'json')
    sprites=[row for row in runtime.read_objects(props,source) if row.get('Type')=='PaperSprite']
    if len(sprites)!=1:raise ValueError('Unsupported UI sprite export')
    data=sprites[0]['Properties']
    atlas=package_path(data['BakedSourceTexture']['ObjectPath'])
    if atlas not in runtime.by_package:raise ValueError('UI sprite atlas is unavailable in current game')
    runtime.export([atlas],root,'png')
    file=root/Path(atlas).with_suffix('.png')
    if not hasattr(runtime,'_ui_atlases'):runtime._ui_atlases=OrderedDict()
    cache=runtime._ui_atlases
    if atlas not in cache:
        with Image.open(file) as image:cache[atlas]=image.convert('RGBA')
    cache.move_to_end(atlas)
    while len(cache)>2:cache.popitem(last=False)[1].close()
    image=cache[atlas]
    uv=data['BakedSourceUV'];size=data['BakedSourceDimension']
    values=[uv['X'],uv['Y'],size['X'],size['Y']]
    if any(not math.isfinite(v) or int(v)!=v for v in values):raise ValueError('Invalid UI sprite coordinates')
    x,y,w,h=map(int,values)
    if min(x,y)<0 or min(w,h)<=0 or x+w>image.width or y+h>image.height:raise ValueError('UI sprite region is outside atlas')
    if data.get('bRotatedInSourceImage'):raise ValueError('Rotated UI sprite requires an adapter update')
    target.parent.mkdir(parents=True,exist_ok=True)
    temp=target.with_name(target.name+'.tmp')
    with image.crop((x,y,x+w,y+h)) as crop:crop.save(temp,format='PNG')
    temp.replace(target)
